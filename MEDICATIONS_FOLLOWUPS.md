# Medications follow-ups (rpm-ios-app)

**Update (2026-08-31): the feature is now built** (schema, RxNorm autocomplete,
patient typed entry, clinician confirm/reject). The authoritative design + status is
in the backend repo: `MEDICATIONS_DESIGN.md`. What remains is the PHOTO path (step 5),
which is what the two concerns below are about — they are no longer "before it's
shippable", they are "before the photo/OCR path ships". The typed path (autocomplete +
free text) is live and every entry goes through clinician review.

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
