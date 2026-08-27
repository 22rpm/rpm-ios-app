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
