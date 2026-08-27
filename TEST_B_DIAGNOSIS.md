# Test B regression diagnosis (cuff off mid-session → lockout) — on fix/bp-auto-reconnect

## RESOLUTION (2026-08-28) — NOT a regression; the "prime suspect" below was WRONG

Test B was re-run on the device on **both DEBUG and RELEASE builds**: screen
responsive, back button works, **no lockout either way**. The "prime suspect" below —
that gating the BLE-callback logging out of RELEASE changed timing and unmasked a race
— **does not hold** (a release build shows no lockout). The earlier "screen lags,
can't back out" report is therefore **UNREPRODUCED, not fixed**: there is no confirmed
root cause and no code change was made for it, and it did not recur on either build.
The reconnect logic is byte-identical to the verified-passing `6f70ef8` state. If it
ever recurs, capture a device trace — do not resurrect the logging-timing theory
without evidence.

_The original investigation is kept below for the record, but its "prime suspect" is
disproven; read it as history, not a live hypothesis._

---

Test B passed at `6f70ef8` (reconnect cadence fix). It is reported failing again on
the same branch (now 1.0.50). This is the diagnosis from code inspection; the
isolating test needs the device.

## What I verified — the reconnect logic is INTACT

The three commits on top of the verified-passing `6f70ef8` are:

- `ed26195` (release prep) — the native `ViatomDeviceManager.m` change is **pure
  logging**: `NSLog(@"📊BPTRACE…")` → `RPMTRACE(…)`, plus the macro. Filtering the
  diff to non-logging lines returns **nothing** — no control-flow change.
- `2dde296` (nav fix) — `handleBack` only (`navigate('Home')` → `goBack()`). Not the
  reconnect/disconnect/scan path.
- `5f44660` (reading confirmation) — `onMeasurementResult` (the RESULT path) + a
  modal. Test B produces NO result, so this code isn't executed during Test B.

The two functions `774d72e` fixed are unchanged:
- **Focus effect** (`BloodPressure.js:979`) — `useCallback(…, [])`, empty deps, so its
  `cancelReconnect` cleanup fires only on real blur, never on a mid-session
  disconnect. Intact.
- **`onDeviceDisconnected`** (`:785`) — no JS respin; native `didDisconnect` arms the
  bounded 15s window. Intact.

**Conclusion: no logic regression landed on the reconnect path.** So the failure is
not a code change to that path.

## Prime suspect: DEBUG-vs-RELEASE logging timing (the RPMTRACE gating)

The ONE behavioral difference between "Test B passed" and now is release-only:
`RPMTRACE` compiles to `NSLog` in DEBUG and to `((void)0)` in RELEASE. Test B was
verified on DEBUG builds — **with ~30 BPTRACE `NSLog` calls firing**, several inside
the tight BLE reconnect callbacks (`didDiscover`, `didFailToConnect`, the retry
path). `NSLog` does synchronous I/O and is slow; those calls added real latency to
that loop.

In a **RELEASE build** (what 1.0.50 ships, and what you may have tested), those logs
are gone, so the reconnect loop runs at full speed. Removing incidental latency is a
classic way to **unmask a latent race** that the logging was accidentally masking —
which would present exactly as the old symptom (loop churn = "lag", frozen UI =
"can't back out").

### Isolating test (needs the device)
1. Build **DEBUG** and run Test B. RPMTRACE == NSLog == the state when it passed.
2. Build **RELEASE** and run Test B.

- Passes in DEBUG, fails in RELEASE → **confirmed**: the timing/race above.
- Fails in BOTH → not the logging; it's a latent BLE race or environment (capture a
  release trace and re-diagnose from the actual sequence).

### If confirmed — stopgap and real fix
- **Stopgap for 1.0.50:** the reconnect (`RC …`) logs are **non-PHI** (reconnect
  state, not BP values). Only the value logs (`RESULT extracted sys/dia`, `outbox
  WRITE`) carry PHI. So we can **un-gate only the RC-path logs** (keep them in
  release) to restore the loop's timing, while leaving the PHI value logs gated.
  Restores Test B behavior without shipping PHI to the device console.
- **Real fix:** the race the logging masked is real and should be fixed in the native
  reconnect loop (guard/serialize the retry vs. window-expiry vs. didFailToConnect
  transitions so it doesn't depend on incidental latency). Needs the release trace to
  pinpoint.

## Secondary (weaker) candidate: the confirmation modal covering "back"

`ReadingConfirmation` is a full-screen transparent `Modal`; while up it covers the
header back button (only its Done button dismisses it). If a reading completes (modal
up) and the cuff powers off before Done is tapped, a confused patient could feel
stuck — but Done still works, and the reconnect behind it is native-bounded, so this
is a UX nit, not the churn/lockout. Note: **do NOT auto-dismiss the modal on
disconnect** — the cuff powering off right after a reading is normal (see
`BloodPressure.js:796`), so that would flash the confirmation away every time.

## Bottom line
No reconnect-logic regression exists. The likely cause is release-only timing from
gating the BLE-callback logging. Confirm with the DEBUG-vs-RELEASE test above before
any fix; the non-PHI-RC-log stopgap unblocks 1.0.50 if confirmed.
