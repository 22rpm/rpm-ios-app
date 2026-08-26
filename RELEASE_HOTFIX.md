# Release: fix/bp-reconnect-loop-hotfix (1.0.49 / build = highest-uploaded + 1)

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

## Version / build — CHECK THE LIVE APP STORE VERSION FIRST

The repo's version string had drifted **20+ releases behind** the live App Store
version (repo said 1.0.27; the App Store was on **1.0.48**), and validation rejected
the upload: "CFBundleShortVersionString must be higher than the previously approved
version." **Never set the bump from the repo — read what is actually published.**

- Live App Store version: App Store Connect → your app → the current live version.
- Highest build number ever uploaded: App Store Connect → **TestFlight → iOS**
  (Builds), each row is `version (build)`; take the max build across ALL rows.

Then:
- `MARKETING_VERSION` = **1.0.49** (must exceed the live 1.0.48). Set on this branch.
- `CURRENT_PROJECT_VERSION` = **(highest uploaded build) + 1** — monotonic app-wide so
  it can never collide. Set this in Xcode's General tab before archiving (the branch
  still holds a placeholder until the real number is known).

Both live in `RPM_App.xcodeproj/project.pbxproj` (Debug + Release).

## Archive → upload

Xcode: destination **Any iOS Device (arm64)** → **Product ▸ Archive** →
Organizer **Distribute App ▸ App Store Connect ▸ Upload**. Then in App Store
Connect create version 1.0.49, attach the processed build, add release notes,
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

## Known non-blocker: "Upload Symbols Failed — no dSYM for hermes.framework"

This warning appears during Distribute and does **NOT** block the upload or the
release — the build ships fine. It only means Apple can't symbolicate crashes that
occur inside the Hermes JS engine (you'd see hex addresses instead of frames in
Xcode Organizer's crash reports). Everything else symbolicates normally. Safe to
ship now; fix later.

Fix (later): a known React Native/Hermes packaging gap — the prebuilt
`hermes.framework` isn't shipping its `.dSYM` in the archive. Options when you get
to it: confirm Release build setting `DEBUG_INFORMATION_FORMAT = dwarf-with-dsym`;
or add a build phase / use the dSYM from the `hermes-engine` pod
(`Pods/hermes-engine/destroot/.../hermes.framework.dSYM`) so it's copied into the
archive's dSYMs. Tracked so it isn't forgotten, but it does not gate this release.
