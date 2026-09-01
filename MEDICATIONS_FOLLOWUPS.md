# Medications follow-ups (rpm-ios-app)

**Update (2026-08-31): the feature is now built** (schema, RxNorm autocomplete,
patient typed entry, clinician confirm/reject, AND the photo path). The authoritative
design + status is in the backend repo: `MEDICATIONS_DESIGN.md`. Every entry — typed,
free text, or photo-read — arrives `unconfirmed` and goes through clinician review.

## 0. Step 5 (photo → OCR → draft) needs a native build — do this before device testing

The photo path reads the label ON-DEVICE with **Apple's Vision framework** and discards
the image immediately; nothing is stored (no camera roll, no upload;
`document_key`/`document_sha256` stay unused until S3). OCR has **zero JS dependencies** —
it's a native Objective-C module using Vision. Only the camera is a JS dependency.

**Build steps:**
```
npm install                         # installs react-native-image-picker (camera)
cd ios && pod install && cd ..      # links image-picker's native code
# Add the Vision OCR module to the Xcode target (one-time):
#   In Xcode, add ios/VTMDeviceManager/MedLabelOCR.h and MedLabelOCR.m to the
#   RPM_App target (they sit next to RPMBrowser.m; "Add Files to RPM_App…", ensure
#   RPM_App target membership is checked). Vision.framework is a system framework and
#   links automatically — no Podfile change.
# then rebuild (Xcode or: npx react-native run-ios)
```

`NSCameraUsageDescription` is already in `ios/RPM_App/Info.plist`. The JS bundle builds
without the native module (labelOcr.js guards on `NativeModules.MedLabelOCR` and degrades
to "type it in instead"); the OCR activates once the two files are added to the target and
the app is rebuilt.

Files: `labelOcr.js` (camera + calls the native OCR + parse), `MedLabelOCR.{h,m}` (Vision
OCR + deletes the file in native — the "nothing is stored" guarantee lives here),
`MedicationCapture.js` (the scan screen, with the "photo isn't saved" line), and the draft
banner in `MedicationEntryScreen.js`. The OCR parse is best-effort — a misread strength
cannot be caught by the app; the patient corrects the draft and a clinician confirms the
entry. See concern #1 below.

Android note: this build wired iOS only (Vision is Apple-only). When Android is built, it
needs its own on-device OCR (e.g. ML Kit) behind the same `labelOcr.js` interface, plus
the Android camera permission.

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
