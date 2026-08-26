# Release: fix/bp-reconnect-loop-hotfix (1.0.27 / build 31)

App Store hotfix for the BLE auto-reconnect lockout (an off/low-battery cuff spun
the scan/connect loop and froze the screen). Ships ahead of the Q4 measurement/
parser work. Changed vs `main`: `ios/VTMDeviceManager/ViatomDeviceManager.m`
(bounded reconnect window + methodQueue + 2s cadence), TWO small edits to
`BloodPressure.js`, and ONE line in `ViatomDeviceManager.js` (expose
`enableAutoReconnect` so the disconnect button actually disables auto-reconnect
instead of re-connecting itself). See "The native-only premise did not hold"
below. Nothing from the measurement, parser, or polling work is included.

## Archive from a CLEAN worktree — do not archive from your day-to-day tree

The primary working tree carries **local `API_BASE` edits pointing at
`http://192.168.1.15:...`** (a dev machine on the LAN). If those ship, every
patient's app talks to a host that does not exist for them — it breaks the app for
everyone. The release binary must contain ONLY this branch's committed code.

```bash
# from the repo root
git worktree add /tmp/rpm-release fix/bp-reconnect-loop-hotfix
cd /tmp/rpm-release/ios && pod install
open RPM_App.xcworkspace
```

Before archiving, confirm the release points at production, not the LAN:

```bash
grep -rn "192.168" /tmp/rpm-release --include=*.js   # must return NOTHING
grep -rn "API_BASE" /tmp/rpm-release/App.js          # must be the prod URL
```

## Version / build

- `MARKETING_VERSION` = **1.0.27** (was 1.0.26)
- `CURRENT_PROJECT_VERSION` = **31** (was 30) — must be higher than any build ever
  uploaded for this version, or App Store Connect rejects the upload.

Both set in `RPM_App.xcodeproj/project.pbxproj` (Debug + Release) on this branch.

## Archive → upload

Xcode: destination **Any iOS Device (arm64)** → **Product ▸ Archive** →
Organizer **Distribute App ▸ App Store Connect ▸ Upload**. Then in App Store
Connect create version 1.0.27, attach the processed build, add release notes,
answer export compliance (standard HTTPS = exempt), and submit. Choose manual
release. Ensure the App Review demo patient account still logs in.

## What's New (suggested)

> Fixes an issue where the blood pressure screen could stop responding if the cuff
> was turned off or low on battery. The app now stops trying to reconnect after a
> short time so you can retry without restarting the app.

## The native-only premise did not hold (why there are JS edits)

This hotfix was scoped native-only, on the assumption that the bounded reconnect
window in the native module would fully govern reconnect behavior. **It does not.**
`main`'s `BloodPressure.js` independently drives the reconnect scan:
1. the `onDeviceDisconnected` handler ran `setTimeout(() => safeStartScan(), 600)`, and
2. the screen's `useFocusEffect` depended on `[connectedDevice, safeStartScan,
   connectionVerified]`, so a mid-session disconnect re-ran it, and its 3s/15s
   timeouts toggled `connectionVerified`, re-running it again and again — a JS-side
   scan/state loop.

The native window bounds the *native* retry loop, but it cannot stop the JS from
calling `startScan` and toggling React state on a timer. Result: on the hotfix,
Test B **still locked** even though the native code was correct (Q4 passed on the
same native code, because Q4's JS delegates to the window and does none of this).

So this hotfix carries two minimal `BloodPressure.js` edits — remove the respin,
and give the focus effect empty deps + a `connectedDeviceRef.current?.id` check so
it runs only on real focus/blur. **Lesson for the next person cutting a
"native-only" fix from this codebase: the JS drives BLE scanning directly. A native
change alone will not change reconnect behavior — audit `BloodPressure.js`'s
disconnect handler and focus effect first.**

## Known limitation (resolved in Q4)

On a **mid-session disconnect**, the hotfix does NOT reopen the manual picker or
show a "cuff not reachable" message. `main`'s JS has no `onReconnectFailed`
listener, and the focus effect no longer re-runs on disconnect — so the native
window bounds the retry silently and, if the cuff stays off, the patient simply
sees nothing happen (the screen stays responsive; they can manually retry). Q4
resolves this with a dedicated reconnect banner + a single "Couldn't connect to
the cuff — check that it's on" toast + the picker at the 15s mark. The hotfix
trades that UX for a minimal, low-risk change; the safety win (no lockout) is
intact. (The cold-tap path still shows the "Device not found" picker at 3s.)

## Clean up the release worktree afterward

```bash
git worktree remove /tmp/rpm-release
```
