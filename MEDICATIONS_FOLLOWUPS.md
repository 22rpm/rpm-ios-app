# Medications follow-ups (rpm-ios-app)

**Update (2026-08-31): the feature is now built** (schema, RxNorm autocomplete,
patient typed entry, clinician confirm/reject, AND the photo path). The authoritative
design + status is in the backend repo: `MEDICATIONS_DESIGN.md`. Every entry — typed,
free text, or photo-read — arrives `unconfirmed` and goes through clinician review.

## 0. Step 5 (photo → OCR → draft) needs a native build — do this before device testing

The photo path reads the label ON-DEVICE and discards the image immediately; nothing is
stored (no camera roll, no upload; `document_key`/`document_sha256` stay unused until
S3). It depends on three native modules that must be installed and the app rebuilt:

```
npm install
cd ios && pod install && cd ..
# then rebuild the app (Xcode or: npx react-native run-ios)
```

Added to `package.json`: `react-native-image-picker` (OS camera, `saveToPhotos:false`),
`@react-native-ml-kit/text-recognition` (on-device OCR, no network), `react-native-fs`
(unlink the temp image). `NSCameraUsageDescription` is already added to
`ios/RPM_App/Info.plist`. Until `pod install` + rebuild is done, the app will not bundle
(Metro resolves the new imports) — this is expected; it's a native step, not a JS one.

Files: `labelOcr.js` (capture + OCR + discard), `MedicationCapture.js` (the scan
screen, with the "photo isn't saved" line), and the draft banner in
`MedicationEntryScreen.js`. The OCR parse is best-effort — a misread strength cannot be
caught by the app; the patient corrects the draft and a clinician confirms the entry.
See concern #1 below.

Android note: ML Kit text recognition also supports Android, but this build only wired
iOS (`Info.plist`). Add the Android camera permission + ML Kit setup when that surface
is built.

## 1. Label OCR is not trustworthy for a clinical record — human verification is required

Reading a pill-bottle label reliably enough to write into a patient's medication
record is hard. OCR misreads drug names and dosages — look-alike names, unusual
fonts, curved bottles, glare, worn or handwritten pharmacy labels — and a **wrong
medication or dose in a patient record is a patient-safety problem**, not a cosmetic
bug. The real feature must have a human (care-team member / pharmacist) **verify
every entry** before it enters the record; OCR at most pre-fills a draft for a person
to confirm. The capture shell's confirmation copy already says "a team member will
review the label," to set that expectation from the pitch onward.

## 2. A medication photo is PHI → the S3 blocker, now THREE features deep

A photo of a medication label is PHI. Storing it hits the same missing secure
object-storage (S3) setup that already blocks two other features. That makes it the
**third feature stalled on the same infrastructure gap**:

1. Consent scans
2. RPM note PDF
3. Medication label photos  ← new

Until secure PHI object storage exists (encrypted at rest, access-controlled,
audit-logged), none of these can store their images/files. Surface it to Husnain as
**one blocker with three dependents**, not three separate asks — it raises the
priority and avoids solving it piecemeal.
