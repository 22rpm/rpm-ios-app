# Device history follow-ups (rpm-ios-app)

Gaps in the Viatom cuff integration around readings stored in the device's own memory.

## 1. The app never fetches the cuff's stored readings — live capture only (OPEN)

**Gap.** The app records a reading only when it is captured **live over a connected
session**. It listens for `onRealTimeData` and `onMeasurementResult` (emitted during an
active measurement) — see `BloodPressure.js` `onDeviceConnected` (:761), which on connect
requests device info + BP config and prompts the patient to start a reading. There is no
path that reads the readings the cuff has stored in its own memory. **A patient who
measures with no phone nearby (or no connected session) loses those readings from the RPM
system.**

**Evidence:**
- `enterHistoryMode()` exists in the JS wrapper (`ViatomDeviceManager.js:44`) and native
  (`ios/VTMDeviceManager/ViatomDeviceManager.m:1393`) but is **never called anywhere** in
  the app. Natively it only does `requestChangeBPState:2`, which is used to **safely exit
  measurement mode** (same call in `exitBPMode`, `ViatomDeviceManager.m:1194`) — not to
  read stored records.
- The native module's complete event surface — `supportedEvents`
  (`ViatomDeviceManager.m:118`): `onDeviceDiscovered, onDeviceConnected,
  onDeviceDisconnected, onRealTimeData, onDeviceError, onBPModeChanged, onBPConfigReceived,
  onBPStatusChanged, onMeasurementResult, onReconnectFailed`. **There is no
  history/stored-record event**, so even if `enterHistoryMode` were called there is **no
  receive channel** to deliver stored records to JS.
- `fetchHistoricalData` / `loadHistoricalData` (`BloodPressure.js:92`, `:543`) read from
  the **backend** (`response.data`) — i.e. already-transmitted readings — **not the
  device**. This is display of server history, not device-memory retrieval.

**Fix scope — native + JS (not a one-liner):**
1. **Native:** add a method to request the cuff's stored records (via the Viatom SDK's
   history/record API), parse them, and **emit a new `onHistoryRecord` event** (add it to
   `supportedEvents`). Each record carries the reading values + the device-side timestamp.
2. **JS:** call the new request **on connect** (in/after `onDeviceConnected`), subscribe to
   `onHistoryRecord`, **dedupe against the durable outbox** (and against already-transmitted
   readings) so records aren't double-counted, and **POST** the new ones through the normal
   ingest path.
3. Result: readings taken offline sync automatically the next time the cuff connects,
   making the system resilient to "no phone nearby."

## 2. Recovery path for readings already sitting in a cuff (operational)

If readings were taken offline and are still in a cuff's memory, they can be recovered
**now**, independent of this app:
- **Manufacturer app.** Connect the cuff to Viatom/Wellue's own app ("ViHealth" /
  "Wellue Health") and read/export its stored history. This both answers "did the patient
  keep measuring" and recovers the values.
- **Buffer may wrap.** Viatom cuff memory is finite (model-dependent — dozens to a few
  hundred records) and older records are overwritten once full. Check sooner rather than
  later; if the buffer wrapped, the earliest offline readings are already gone.

**This compounds with the prod cert outage** (`../rpm-backend/INCIDENT_2026-09-03_prod-cert-san.md`).
During the outage a *connected* iOS phone also couldn't POST (TLS failed), and **1.0.49 had
no durable outbox**, so live captures in that window were lost too. That makes the cuff's
own memory the single best recovery source for any readings taken from ~Aug 21 onward —
worth pulling via the manufacturer app before the buffer rolls over.
