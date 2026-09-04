# Device history sync — design (no code yet)

**Goal.** When a patient connects after a gap, the app pulls every reading stored on the
cuff that we don't already have, timestamps them with the device's own measurement time,
dedupes, and posts them — so readings taken offline (or during a backend outage) are not
lost. Companion to `DEVICE_HISTORY_FOLLOWUPS.md` #1.

SDK: `VTMProductLib` (`ios/Pods/VTMProductLib/VTMProductLib.xcframework`), utility class
`VTMURATUtils` (our `viatomUtils`), parser `VTMBLEParser`, structs `VTMBLEStruct.h`.

---

## What the SDK actually supports (from the vendor headers, not our wrapper)

### 1. Reading device memory — a FILE model
Stored readings are exposed as files, read over four calls on `VTMURATUtils`
(`VTMURATUtils.h`) with results delivered async through the delegate
`- util:commandCompletion:cmdType:deviceType:response:(NSData)` (`:68`), then parsed by
`VTMBLEParser`:
- `requestFilelist` (`:124`) → `VTMBLEParser parseFileList:` (`VTMBLEParser.h:22`) →
  `VTMFileList` = `u_char file_num` + `VTMFileName fileName[255]` (`VTMBLEStruct.h:145`).
- `prepareReadFile:(name)` (`:128`) → `parseFileLength:` (`:24`) → `VTMOpenFileReturn.file_size`.
- `readFile:(u_int offset)` (`:131`) → `parseFileData:` (`:26`) → raw bytes; call in a loop
  by offset until `file_size` is reached.
- `endReadFile` (`:135`).
- `deleteFile:(name|nil)` (`:159`) — nil deletes all. (We likely will NOT use this — see dedup.)

Each file's bytes parse into a BP result struct; `VTMBLEParser parseBPResult:` is already
used in our code (`ios/VTMDeviceManager/ViatomDeviceManager.m:584`) for the live path, so
the same parser applies to stored files.

### 2. Do stored records carry a timestamp? YES — this is the make-or-break, and it's good.
`VTMBPBPResult` (`VTMBLEStruct.h`, "blood pressure result of bp2/bp2a") fields:
- `u_int measuring_timestamp;` — **Unix epoch seconds of the measurement** ("测量时间时间戳 … 1970.01.01").
- `u_short systolic_pressure;` `u_short diastolic_pressure;` `u_short mean_pressure;` (mmHg)
- `u_char pulse_rate;`
- `u_char medical_result;` (bit0 = irregular heartbeat)
- `u_char status_code;` `u_char file_type;` (1 = BP, 2 = ECG) `u_char file_version;`

So we can **backfill with the real measurement time** — a week of readings do NOT collapse
onto "today," and the 99454 day-count stays correct **IF the device clock is right (see #3).**

### 3. Whose clock — and can it drift? DEVICE clock, and WE NEVER SET IT.
`measuring_timestamp` is stamped by the **device's** internal clock at measurement time.
The SDK can set that clock: `syncTime:(NSDate)` (`:121`) and `syncTimeZone:` (`:147`), and
the device reports its current time via `requestDeviceInfo` → `VTMDeviceInfo.cur_time[7]`
(`VTMBLEStruct.h:117`). **Our native module never calls `syncTime`/`syncTimeZone`** (grep
confirms). So the device clock is whatever the factory or the manufacturer app last set —
and it can drift, or reset to a default epoch on power loss. **Risk:** history timestamps
could be wrong, which would misdate 99454 days. Mitigations (part of this work):
- Call `syncTime`/`syncTimeZone` on every connect (fixes it going forward).
- On connect, read `VTMDeviceInfo.cur_time` and compare to the phone clock; if the offset
  is large, correct or flag the history timestamps and surface it, don't post silently.
- Sanity-bound each record: drop/flag timestamps in the future or absurdly old.

### 4. Buffer size and overwrite — PARTIALLY known, MUST TEST.
`VTMFileList` caps at **255** entries (`u_char file_num`, `fileName[255]`) — so at most ~255
stored records. **Whether the device overwrites oldest when full is not in the headers** —
it's firmware-dependent. **Must test on device** (or get vendor confirmation). If it wraps,
a long outage past the buffer loses the earliest readings (the "buffer may wrap" caveat in
DEVICE_HISTORY_FOLLOWUPS #1).

### 5. Dedup / unique identity — the natural key is `measuring_timestamp`, BUT there's a trap.
The unique key for a stored reading is its `measuring_timestamp` (a patient doesn't measure
twice in the same second), optionally plus values.
**The trap:** the LIVE path does NOT record the device timestamp. Live
`onMeasurementResult`/`onRealTimeData` set `timestamp = [NSDate date]` (the PHONE clock at
receipt — `ViatomDeviceManager.m:278/296/324/…`), and JS uses `new Date().toISOString()`
(`BloodPressure.js:494`). So the SAME reading has a **phone-clock** timestamp in `dev_data`
(live) and a **device-clock** timestamp in history — different clocks, different instants.
A naive timestamp-equality dedup across the two sources FAILS.
Fix (recommended, small and worth doing with this feature): change the **live** path to use
the parsed `VTMBPBPResult.measuring_timestamp` (already available at
`ViatomDeviceManager.m:584`) as the reading time, so live and history share one device-clock
key and dedup is exact. Fallback if we can't: fuzzy dedup on `(systolic,diastolic,pulse)`
within a time tolerance window — less reliable.

---

## Design

### Native (VTMDeviceManager)
- New `RCT_EXPORT_METHOD(readStoredRecords)`: run the file protocol — `requestFilelist` →
  for each file `prepareReadFile`/`readFile`(loop by offset)/`endReadFile` → `parseBPResult`
  → collect `{ measuring_timestamp, systolic, diastolic, mean, pulse, irregular, file_type }`.
  Skip `file_type == 2` (ECG) for BP sync. Serialize the reads (one file at a time; the
  delegate is single-in-flight).
- Emit **`onHistoryRecord`** per record (or one `onHistoryBatch` array), plus
  **`onHistorySyncComplete`** `{count}` and **`onHistorySyncFailed`** `{reason}`. Add all
  three to `supportedEvents` (`ViatomDeviceManager.m:118`) — today there is NO history event,
  so this is the missing receive channel.
- Add `syncTime`/`syncTimeZone` on connect (see #3).
- Do NOT `deleteFile` — leave records on the device as a backup; idempotent re-reads are made
  safe by dedup, not by deletion.

### When it fires
- After `onDeviceConnected` + connection verified, when NOT starting/among a live
  measurement. The device is either measuring or available for file reads; **must test**
  whether file reads require a BP-state change (`requestChangeBPState`, `:197`) and whether
  that conflicts with the live-reading flow. Likely: kick off the sync on connect in the
  background, gated so it never runs during an active measurement.

### Dedup + post (JS)
1. On connect, determine the **high-water mark**: the newest reading time we already have for
   this patient (from the backend, or a local cache of last-synced device timestamp).
2. Subscribe to `onHistoryRecord`; keep only records with `measuring_timestamp` > high-water
   mark; dedup against the durable outbox and already-sent set (key = device
   `measuring_timestamp`; see #5 — align the live path to the same key).
3. POST each surviving record through the normal `dev_data` ingest, with the reading time =
   the **device** `measuring_timestamp` (not phone clock), so the 99454 day-count buckets on
   the true measurement day.

### What the patient sees
- Non-blocking banner: "Syncing readings from your device…" → "Added N past readings."
  Never blocks taking a new live reading. If there's nothing new, stay silent.

### POST fails mid-batch
- Each history record becomes a **durable-outbox** entry (the outbox already exists), POSTed
  independently and retried; partial success is fine because dedup (by device timestamp)
  makes re-sends idempotent. Nothing is deleted from the device, so a total failure loses
  nothing — the next connect retries. Never advance the high-water mark past a record that
  hasn't been confirmed stored server-side.

---

## Must test on device (cannot determine from the SDK headers)
1. **Buffer capacity + overwrite-oldest behavior** (#4) — how many records, and does it wrap?
2. **Device clock accuracy/drift** (#3) — read `cur_time` vs real time; how far off is a cuff
   that's never been `syncTime`'d? This directly gates 99454 accuracy.
3. **File read vs measurement state** — do `requestFilelist`/`readFile` work in the current
   BP state, or require `requestChangeBPState`? Does that interrupt a live reading?
4. **File structure** — one file per measurement, or one file with many records? Filename
   semantics (does the name encode a timestamp/index)? Determines the read loop.
5. **Model coverage** — the structs say bp2/bp2a. Confirm the patient's actual cuff model is
   covered by this file/record layout; a different model may differ.
6. **Backend dedup key** — `dev_data` has no unique reading key today; confirm we can dedup
   server-side (or client-side) on `(patient, device measuring_timestamp)` once the live path
   also carries that timestamp.

## Why this matters now
Combined with the cert outage (`../rpm-backend/INCIDENT_2026-09-03_prod-cert-san.md`) and no
durable outbox on 1.0.49, any readings taken from ~Aug 21 on were never delivered — but if
they're still in the cuff's 255-record buffer with real `measuring_timestamp`s, this feature
recovers them accurately on the next connect. Recovery for the CURRENT gap is still the
manufacturer app (DEVICE_HISTORY_FOLLOWUPS #1); this design prevents the next one.
