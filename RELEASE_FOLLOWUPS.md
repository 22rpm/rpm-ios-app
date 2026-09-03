# Release follow-ups (rpm-ios-app)

## 1. Build number: App Store Connect is authoritative, NOT the repo
The repo's `CURRENT_PROJECT_VERSION` has drifted 20+ releases from what actually shipped —
e.g. **1.0.49 shipped as build 51** while the repo pbxproj carried **31/32**. Do not trust
the repo pbxproj as "what shipped"; a build numbered off the repo value gets rejected at
upload for being lower than a build already in App Store Connect.

**Every release, before archiving:**
1. Read the **highest build number in App Store Connect** (the TestFlight / App Store build
   list), across all `1.0.x` marketing versions — build numbers must be unique and
   increasing app-wide, not per marketing version.
2. Set `CURRENT_PROJECT_VERSION` in **both** the Debug and Release configs of
   `ios/RPM_App.xcodeproj/project.pbxproj` to that highest **+ 1**. `agvtool next-version -all`
   does this, or edit both lines by hand.
3. **Commit the bump as part of the release**, so the committed repo matches ASC. A bump
   made only in Xcode at archive time and never committed is exactly how this drift recurs
   (it's what produced the 31/32 vs 51 gap).

`Info.plist` reads `$(CURRENT_PROJECT_VERSION)` / `$(MARKETING_VERSION)`, so the pbxproj is
the single source of truth — there is no second place to update.

Related: the same repo-vs-reality drift class on the backend is documented in the backend
repo's `SECURITY_FOLLOWUPS.md` #5 ("Production working tree drifts from git").
