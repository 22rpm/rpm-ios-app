# Outbox / reconnect — follow-ups

Deferred work from the durable-outbox + bounded-reconnect changes on
`fix/bp-auto-reconnect`. None of these are built yet.

## 1. Staleness surface (the "visible failure mode")

The outbox is now the single delivery path, so a systemic drain failure loses
nothing but hides everything — a queued reading is invisible until someone counts
transmission days. Surface it:

- **Patient:** when `oldestPendingAgeMs()` (in `outbox.js`) crosses ~24h, show a
  persistent banner on Home/BloodPressure — "A reading hasn't reached your care
  team yet" — plus a manual **Retry now** that calls `drainOutbox()`. Show a
  subtle "N pending upload" whenever the queue is non-empty.
- **Staff:** a queued reading by definition hasn't reached the backend, so staff
  can't see it directly. Cheapest honest signal: **piggyback outbox depth + oldest
  age on requests that already succeed** (login / token refresh) — e.g. an
  `x-outbox-pending` header/field — so the server learns the backlog whenever the
  device reaches it. Dashboard alert when pending > 1 day. Limit: a fully-offline
  phone can only be represented as "last-seen + backlog as of last contact."

## 2. Repeated-4xx is a DISTINCT signal from "offline"

"Delete only on success" means a **malformed** row (one the server will always
reject with a 4xx) never drains and sits in the queue forever — and to the age
threshold it looks identical to "offline / delivery failing." These need
different handling and different alarms:

- Track a per-row attempt count / last-error in the outbox record.
- A row that has failed with a **4xx** (not 401 — that's an auth state, retryable
  after login; a 400/422 is a permanent client error) N times is *poisoned*: it
  will never drain. Move it to a dead-letter state and raise a **distinct** signal
  ("a reading could not be delivered and needs attention"), not the "offline"
  banner. Do NOT silently drop it.
- Keep 401 / 5xx / timeout / network as ordinary retryable (what we have today).

This distinction matters because the "offline" banner tells the patient to check
their connection — useless advice for a malformed row, and it masks a real bug.

## 3. Remove the dead direct-write path

`storeMeasurementData` and `storeDeviceData` in `BloodPressure.js` are no longer
called (the outbox is the single write path). They mint a **fresh** `timestamp`
per call, so if a future change reintroduces a call, it would create a second
write path with a different dedup key and defeat server idempotency. Remove both.

## 4. JS bridge wrapper maintenance

`ViatomDeviceManager.js` is a hand-maintained whitelist; a native
`RCT_EXPORT_METHOD` not added there is a silent no-op via `?.()`. This bit us:
`beginReconnect`/`cancelReconnect`/`enableAutoReconnect` were no-ops from 592ea42
until `5ee272a`. The maintenance rule is now a header comment in the wrapper.
Consider a stronger guard: a dev-time assertion that every native method name is
present in the wrapper, or auto-exposing `NativeModules.ViatomDeviceManager`
methods that aren't explicitly overridden.
