# Security follow-ups (iOS app)

Tracked, NOT fixed. iOS-app findings. Surfaced during the Q4 BP release prep on
`fix/bp-auto-reconnect` (2026-08-26). The backend equivalent lives in
`rpm-backend/SECURITY_FOLLOWUPS.md`; this is the iOS-side list.

## 1. Account password stored in plaintext in AsyncStorage (biometric login) — HIGH, LIVE in prod

**What.** When a patient enables Face ID login, their account password is written
verbatim to AsyncStorage:
- `Login.js:229` — `AsyncStorage.setItem('biometric_password', userPassword)` in
  `storeCredentialsForBiometric(userEmail, userPassword)`; `userPassword` is the
  raw password the patient typed. The identifier goes to `biometric_email`
  (`Login.js:228`).
- On a successful Face ID prompt, `performAutoLogin()` reads it back
  (`Login.js:161`) and POSTs it verbatim to `/api/auth/login` (`Login.js:175`).
- It is removed only when the patient explicitly turns off Face ID login
  (`removeStoredCredentials`, `Login.js:238-239`).

**Why it's a finding.** AsyncStorage on iOS is **not encrypted**. The React Native
iOS backend (`RCTAsyncLocalStorage`) persists to a manifest plist plus per-key
files under the app's `Library/Application Support/`, protected only by the app
sandbox and the default file data-protection class — there is no app-level
encryption and no biometric/passcode gate on the value itself. So the password
sits at rest in plaintext, readable by anything with app-container access:
- a jailbroken or malware-compromised device,
- an **unencrypted** local backup (Finder/iTunes without "Encrypt local backup"),
- forensic / MDM extraction.

Passwords are the worst secret to leak this way, because of cross-service reuse,
and this is a medical app — the same credential unlocks PHI. This predates Q4: it
is **live in production today**. The Face ID fix (`f0efab8`) changed the retry
loop, not the storage, so it neither introduced nor addresses this.

**Severity: HIGH** — plaintext, reusable credential at rest.

**Fix.**
- *Correct storage:* move the secret to the iOS **Keychain** with a biometric
  access control — `SecAccessControl` with `.biometryCurrentSet` and
  `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` — so retrieval is
  hardware-gated on Face ID and the value is never in plaintext at rest.
- *Better — stop storing the password at all:* store a server-issued, **revocable**
  device/refresh token in the Keychain and exchange that on biometric unlock, so a
  compromise is revocable and is not the patient's actual reusable password. This
  reuses the existing refresh-token flow.
- *Migration:* the fix must also **delete the legacy `biometric_password` /
  `biometric_email` keys** from AsyncStorage on upgrade for users who already
  enabled Face ID — otherwise the plaintext copy lingers on their device after the
  code stops writing it.
- *Dependency note:* `react-native-biometrics` is already present but only does the
  biometric **prompt**, not secure storage. Keychain access needs either
  `react-native-keychain` (a new JS dependency) or a small native Keychain module
  (no new JS dependency). Decide the dependency question when scheduling the fix.
