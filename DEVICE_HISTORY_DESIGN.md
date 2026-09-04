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

---

## Update — findings from the ingest/clock investigation (both must be handled)

### A. `dev_data.created_at` is server-receipt time, and the 99454 count buckets on it — existing counts may already be wrong
Confirmed in the backend:
- Every active insert stamps `created_at` on the DB, never from the client:
  `services/devData.service.js:7` (`INSERT INTO dev_data (dev_id, data)` — no `created_at`),
  plus `services/deviceData.service.js:819` (`… (dev_id, user_id, dev_type, data)`) and
  `:1838` (`createBPDataService`), none of which set it. The column defaults to now() via
  the migration `20250819125116_create_dev_data_table.js:6` (`table.timestamps(true, true)`).
- The 99454 transmission-day count buckets on `created_at`:
  `services/rpmNote.service.js:140,142` (`DISTINCT dayBucket(created_at) … WHERE …
  monthWhere(created_at)`). So the billable day is **when the server received the row**, not
  when the reading was taken.
- The iOS payload does carry a time — `data.timestamp = new Date().toISOString()` (the PHONE
  clock at store time, `BloodPressure.js:494` in `storeMeasurementData`) plus `data.date` /
  `data.time` — but the count ignores it, and it's the phone clock, **not** the device
  `measuring_timestamp` (which is parsed natively at `ViatomDeviceManager.m:584` and then
  discarded).

**Consequence:** any reading that isn't delivered the instant it's taken is dated by receipt.
A morning reading synced that evening lands on the evening; a batch of queued readings flushed
by the durable outbox lands on **one** `created_at` instant, collapsing multiple days into one
transmission day → **the 99454 count can undercount.** This predates the history feature — it
affects the live path too.

**The Aug 23 identical `00:04:05` rows** are the fingerprint of exactly this: several readings
inserted at one server instant (an outbox flush just after midnight), so their true days
collapse onto Aug 23. To confirm on prod, compare the stamped time to the embedded time:
```sql
SELECT id, created_at,
       data->>'$.timestamp' AS phone_ts,
       data->>'$.date' AS d, data->>'$.time' AS t
FROM dev_data
WHERE user_id = <patient> AND created_at BETWEEN '2026-08-23 00:00:00' AND '2026-08-23 00:10:00'
ORDER BY id;
```
If `created_at` is identical across rows while `phone_ts`/`date` differ, that proves batch
receipt-stamping and that the embedded time is the truer measurement time.

**Fix (bigger than this feature — flag to Cleo, billing-accuracy):**
- The reading must carry its **measurement time** end to end. For live readings, send the
  device `measuring_timestamp` (available at `ViatomDeviceManager.m:584`) in the payload —
  not the phone clock. For history records, it's already the record's `measuring_timestamp`.
- The 99454 day-count (`rpmNote.service.js:140`) should bucket on that **measurement
  timestamp**, not `created_at`. `created_at` stays as the audit/receipt trail.
- This is a claims-affecting change: whether past months should be recomputed is a billing
  decision for Cleo, not a silent code change. Recorded here so it isn't lost; the history
  feature MUST NOT ship posting device readings against `created_at`, or it would repeat the
  bug for backfilled data.

### B. Device-clock offset must be captured BEFORE syncTime, then applied to history
`syncTime` on connect fixes only *future* readings; records already in the buffer were stamped
by whatever the clock said when they were taken. If we sync first, we destroy the evidence of
how far off the clock was. So the order is:
1. On connect, **read the device's current time first** (`requestDeviceInfo` →
   `VTMDeviceInfo.cur_time`, `VTMBLEStruct.h:117`) and compute
   `offset = phoneNow − deviceNow`.
2. **Read the history**; each record's `measuring_timestamp` is on the un-synced clock.
3. **Apply the offset** to each historical record (`corrected = measuring_timestamp + offset`)
   before dedup/post. (Assumes the drift is ~constant since the readings were taken — a single
   offset; note it can't correct a clock that was *reset* between readings and now. Sanity-
   bound the result and flag records that still look implausible instead of posting silently.)
4. **Only then call `syncTime`/`syncTimeZone`** to correct the clock going forward.
Record both the raw `measuring_timestamp` and the applied `offset` on each posted reading so
the correction is auditable.

---

## Device test checklist (work through with a real cuff)

- [ ] **Buffer size** — take/observe readings and read the file list; how many records does
      it hold before it stops growing? (Header caps the list at 255; real capacity may differ.)
- [ ] **Overwrite behavior** — once full, does a new reading drop the OLDEST, or refuse? This
      decides whether a long outage loses the earliest readings.
- [ ] **Clock drift** — read `VTMDeviceInfo.cur_time` on a cuff that's never been `syncTime`'d
      and compare to real time. How far off is it? (Gates 99454 accuracy for backfill — finding B.)
- [ ] **File read vs live reading** — do `requestFilelist`/`readFile` work in the current BP
      state, or require `requestChangeBPState`? Does a history read interrupt or block a live
      measurement, and vice versa?
- [ ] **File structure** — one file per measurement, or one file with many records? What does
      the filename encode (timestamp? index?)? Determines the read/parse loop.
- [ ] **Model confirmation** — the structs say bp2/bp2a. Confirm the patient's actual cuff
      model uses this file/record layout; a different model may differ.
- [ ] **(Bonus, ties to finding A)** — for a batch of live readings, compare each row's
      `created_at` to its embedded `data.timestamp`; quantify how often receipt-stamping has
      already shifted a reading's day.
