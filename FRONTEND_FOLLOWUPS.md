# Frontend follow-ups (rpm-ios-app)

Tracked, NOT fully fixed. iOS-app UI / navigation issues. (The dashboard has its
own list in `rpm-dashboard-v1.0/FRONTEND_FOLLOWUPS.md`.)

## 1. TWO home routes coexist — hardcoded back targets land on the wrong one — PATCHED, root open

**Defect.** The navigator registers two home screens as live routes: the classic
`Home` (`Home.js`) and the redesigned `PatientHome` (`PatientHome.js`). Any screen
that hardcodes `navigation.navigate('Home')` as its back action pushes the CLASSIC
home onto the stack regardless of where the user actually came from — so reached
from PatientHome, "back" lands on the old home instead of popping.

**Symptom seen.** From PatientHome → Readings (BloodPressure) → back returned to the
classic Home, not PatientHome. Same class as the dashboard's FRONTEND_FOLLOWUPS #1:
hardcoded navigation targets plus two parallel navigation notions, with nothing in
the code signaling which a screen must use.

**Patched (`2dde296`).** BloodPressure, ECG, and Connection now use
`navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home')`, so
back pops to the real previous screen with the old route as a fallback. Profile.js
and Oxygen.js already used `goBack()`. This stops the symptom but does NOT remove
the root cause — any NEW screen that hardcodes `navigate('Home')`, or any flow that
assumes a single home, reproduces it.

**Real fix — 1.0.51: make PatientHome THE `Home` route.** Collapse to one home once
PatientHome has been dogfooded: swap PatientHome onto the `Home` route and drop the
separate `PatientHome` route (or repoint every `replace('Home')` / `navigate('Home')`
and retire `Home.js`). With a single home, `navigate('Home')` and `goBack()` can no
longer disagree and the hardcoded-target pattern stops being a latent bug. Until
then: every screen's back must use `goBack()`, and no new screen should hardcode a
home route.

**Audit.** Back handlers hardcoded to 'Home' at patch time: `BloodPressure.js`,
`ECG.js`, `Connection.js` (first `handleBack`). Regression grep:
`grep -rnE "navigation.*navigate\(['\"]Home['\"]\)" --include='*.js' .`

## 2. Info.plist permission strings — vehicle copy REWORDED in 1.0.50; Location-key REMOVAL still deferred to 1.0.51
**Update (1.0.50, build 52):** the two vehicle-copy strings were reworded honestly in
this cycle (the Info.plist was already open to add `NSPhotoLibraryUsageDescription` for
the 90683 upload fix, and Apple reads these): `NSBluetoothAlwaysUsageDescription` → the
cuff/monitoring-device copy shown at pairing; `NSLocationWhenInUseUsageDescription` →
reworded to a bare disclaimer ("does not use your location for tracking or routes") with
**no purpose claimed** — since the native path hasn't been audited, the string asserts
nothing unverified. `NSFaceID` and
`NSCamera` were already honest; `NSBluetoothPeripheralUsageDescription` is absent.

**Still deferred to 1.0.51 — the Location-key REMOVAL, not the wording.** We did NOT
remove `NSLocationWhenInUseUsageDescription` because the native Viatom BLE library was
not audited for a CoreLocation request, and removing a key something requests crashes on
first use. 1.0.51: audit the Viatom native path (`.m`/`.swift` in `ios/VTMDeviceManager`)
for any location request; if truly none, remove the key — otherwise keep it and the
reworded string stands. Rewording was zero-risk and shipped now; removal needs a device
test.

The usage strings are copied from an automotive app and are wrong for a medical RPM
app (`ios/RPM_App/Info.plist`):
- `NSLocationWhenInUseUsageDescription` — "...accurate vehicle performance data and
  track your routes."
- `NSBluetoothAlwaysUsageDescription` — "...connect to and communicate with your
  vehicle's RPM monitoring device for real-time performance tracking."
- (`NSFaceIDUsageDescription` and `NSCameraUsageDescription` read fine — leave them.)

**1.0.51 — Bluetooth:** rewrite honestly, e.g. "This app uses Bluetooth to connect to
your blood-pressure cuff and other monitoring devices."

**1.0.51 — Location: VERIFY-THEN-REMOVE. The key comes out ONLY if nothing requests
location — a missing usage string CRASHES the instant the location API fires.**
Searched on `fix/bp-auto-reconnect` (2026-09, build 32) and found nothing requests it:
- JS: no `navigator.geolocation`, no `react-native-geolocation`, no CoreLocation use.
- Native iOS: no `CoreLocation` / `CLLocationManager` / `requestWhenInUseAuthorization`
  in any `.m` / `.h` / `.swift`.
- Pods: no location pod in `Podfile` / `Podfile.lock` (the Viatom BLE lib does not
  pull CoreLocation).
- The only "location" references are INERT: `PrivacySecurityScreen.js` has a "Location
  Tracking" UI toggle that stores a boolean (`useState`) but calls no location API, and
  `Oxygen.js` `location:'default'` is a SQLite path param.
So the key is removable — **but re-run that exact search at 1.0.51 time and confirm the
PrivacySecurityScreen toggle hasn't since been wired to CoreLocation. If anything
requests location, KEEP the key and only rewrite the string honestly.**

## 3. Connection (messaging) screen still registered though unreachable — DEFERRED to 1.0.51
Messaging entry points were pulled for 1.0.50 (Home.js "Chat" menu item commented out;
PatientHome `NAV_ITEMS` Messages removed — commit `b48de7c`), but the messaging screen
is STILL registered in the navigator at `App.js:190`:
`<Stack.Screen name='Connection' component={Connection}/>`. It is NOT reachable (no live
`navigate('Connection')`, no deep link, `initialRouteName="Login"`), but it is latent —
a future stray `navigate('Connection')` would light up a patient-messages-into-the-void
screen (Connection.js = ConversationsList + ChatScreen, socket.io, `/conversations`).

**1.0.51 fix:** remove the `App.js:190` registration (one line). Do NOT remove the
messaging code (`Connection.js`) from the bundle — that is deliberately deferred as too
large a diff right before a build; registration line only. Re-add BOTH the registration
and the entry points only when Messages actually ships — the clinician side must be live
and monitored first (see `b48de7c` rationale + branch `fix/messages-e2e`).

## 4. `PrivacySecurity` screen is registered but has no navigation path — orphan, pre-1.0.50
`<Stack.Screen name='PrivacySecurity' component={PrivacySecurity}/>` is registered at
`App.js:195`, but **nothing navigates to it** — no `navigate('PrivacySecurity')` /
`replace('PrivacySecurity')` anywhere in the app (verified by grep). It has been
unreachable since before 1.0.50, so it is NOT a regression and was deliberately left out
of the 1.0.50 nav work (no untested screen added to a release build).

**1.0.51:** decide whether it should be reachable — most likely wired from `Settings`
(a "Privacy & Security" row) or from `Profile` — then test it. If it's dead, remove the
registration. Until then it ships as inert dead-registered code, same class as the
`Connection` messaging screen (#3).

## 5. Cuff-off jumped to OLD Home once — SYMPTOM mitigated, ROOT CAUSE UNEXPLAINED
During 1.0.50 device verification on **build 52 (current HEAD, not a stale archive)**,
powering the cuff off mid-session on the Blood Pressure screen caused the app to jump to
the retired Home screen instead of staying put / on PatientHome. **It happened once and
did NOT reproduce.**

**The audit found no device-event path that can navigate.** BloodPressure.js and ECG.js
`onDeviceDisconnected` set state and show a banner only; `onDeviceError` /
`onReconnectFailed` show a toast + the device-picker modal; `handleBack` is the only
`navigation.*` call in either screen and is wired **only** to the on-screen back button.
There is no global navigation ref, no ErrorBoundary, and no session/401 → Home handler
anywhere. So nothing in the current source explains a disconnect that navigates on its own.

**What the fix does — and does NOT do.** All six back-handler fallbacks were changed from
`navigate('Home')` to `navigate('PatientHome')` (BloodPressure.js:1078, ECG.js:162,
Education.js:60, ArticleScreen.js:16, Readings.js:54, Connection.js:39), matching the
Settings.js:107 fix. This retires the OLD Home as a navigation target everywhere, so the
symptom is now **harmless** — the worst case lands on PatientHome, the real landing. **It
does not explain the cause.** Whether a back-tap was involved during the repro is unknown
(not remembered), which is exactly why this is recorded as open rather than closed.

**If it recurs, capture:** the exact screen, whether anything was tapped (especially the
back button), a screen recording, and the JS console/`[BLE]` log around the disconnect.
That's what a root cause needs; absent it, this is mitigation, not a fix.
