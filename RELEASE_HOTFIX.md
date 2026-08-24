# Release: fix/bp-reconnect-loop-hotfix (1.0.27 / build 31)

Native-only App Store hotfix for the BLE auto-reconnect lockout (an off/low-battery
cuff spun the scan/connect loop and froze the screen). Ships ahead of the Q4
reconnect UI. Single changed file vs `main`: `ios/VTMDeviceManager/ViatomDeviceManager.m`.

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

## Clean up the release worktree afterward

```bash
git worktree remove /tmp/rpm-release
```
