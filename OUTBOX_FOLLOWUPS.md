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

## 5. Background delivery — URLSession background transfer (extension of the outbox)

Today: durable capture in the background (native writes the reading to the outbox
even while backgrounded), but DELIVERY is foreground `axios` — it drains on the
next app open. This section is what it takes to deliver "from the pocket" without
the patient opening the app. NOT built.

**What it is.** A `URLSession` created with
`backgroundSessionConfigurationWithIdentifier:`. You hand it a FILE-backed upload
task; the OS daemon (`nsurlsessiond`) runs the transfer out-of-process and
relaunches the app in the background (`handleEventsForBackgroundURLSession`) to
deliver the result. Completes even after the app is suspended or terminated.

**Scope.**
- Delivery moves from JS/axios to NATIVE. Native builds each request (URL,
  body-as-file, auth) and enqueues one upload task per outbox row; the JS drain
  becomes the foreground fallback (or is removed).
- Body-as-file: background uploads must be file-based, so each outbox record is
  written as a request-body file.
- Auth rides `NSHTTPCookieStorage` (a background session can use the shared cookie
  jar), so the session cookie carries — but a background 401 must REQUEUE, not
  delete (the existing "delete only on confirmed success" already enforces this).
- AppDelegate wiring: retain the completion handler, map tasks->rows across
  relaunch, clear on 201 / requeue on failure via the URLSession delegates.

**Risk.**
- Delegate lifecycle is finicky (relaunch handling, completion-handler retention,
  task->row mapping across a cold start); higher bug surface than the JS drain,
  and hard to test (real device, force-quit, network toggling -> slow iteration).
- iOS schedules background transfers DISCRETIONARILY (batched for power/radio), so
  it is "delivers within minutes to tens of minutes," not instant. Fine for RPM.
- Token expiry while queued -> background 401 -> requeue; background token refresh
  is itself constrained, so a long-queued row still lands on the next foreground.
- Duplicate delivery from retry/relaunch -> covered by server idempotency (keyed
  on the baked `data.timestamp`). This is why it composes.

**Independent or extension?** An EXTENSION of the outbox, not independent. The
outbox already provides the three hard parts — durable on-disk capture, a baked
per-reading timestamp that makes retries idempotent, and delete-only-on-success.
Background transfer swaps the TRANSPORT of the drain leg while reusing all of it.
Without the outbox you would build those first; with it, this is "change how/when
rows drain," not what is stored or the success semantics.

**Value / price.** Moves from "durable capture, delivery on next app open" (the
patient must remember to open the app) to "durable capture, delivery on iOS's
background schedule" (they do not). For an elderly population that is the whole
difference. Price: a native background-networking module + AppDelegate lifecycle
wiring + slower testing — bounded because persistence/idempotency/success-gating
already exist.
