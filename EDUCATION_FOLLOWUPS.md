# Education follow-ups (rpm-ios-app)

Decisions and gaps for the patient-education feature. v1 ships owned content (the
BP guide) first, then MedlinePlus deep-links as a placeholder (see #2).

## 1. No ICD-10 on the patient record → education can't be per-patient — OPEN

MedlinePlus Connect is **code-driven**: you call it with a diagnosis code (ICD-10-CM
or SNOMED) and it returns the matching patient-education links. We store **no
diagnosis code anywhere on the patient record** — it's an existing gap, already
known on the RPM note (there's no structured problem/ICD-10 field).

**Consequence for v1.** We hardcode hypertension (`I10`), so *every* patient sees
the identical hypertension articles regardless of why they're actually enrolled. A
CHF or COPD patient gets blood-pressure content. That's acceptable for a
shape-proving placeholder, not for real education.

**What real per-patient education needs.** Capture an ICD-10 (or SNOMED) diagnosis
on the patient record — at enrollment and/or on the RPM note — then map each
patient's code(s) into MedlinePlus Connect (and into #2's owned articles). Once the
code exists, the Education tab becomes per-patient with no further client work; it
also unblocks other Infobutton-style features (medication and lab-test education).

**Cross-repo.** The storage change is backend + dashboard (RPM note / enrollment
form), not iOS. This entry tracks the dependency; the fix lives there.

## 2. Option C — author our own patient-education summaries — PROPOSED (the real answer)

**Why, not links.** Reading level is the actual problem, not availability. Free
sources skew too hard: MedlinePlus is 5th–8th grade (decent) but topic-uneven;
NHLBI/CDC run ~8th–10th; Mayo (paid) ~10th+. A grade-12 article for a 74-year-old
on three medications is not education. Owned content is the only way to *control*
reading level (target **6th grade**, validated with a readability tool) and carry
no licensing constraints. Treat Option A (MedlinePlus links) as a placeholder that
proves the UI shape; Option C is the answer for the common cases.

**How many articles.** Coverage is smaller than it looks because RPM concentrates
on a few chronic conditions:
- **Core conditions (~8–10):** hypertension, type 2 diabetes, heart failure, COPD,
  obesity / weight management, high cholesterol, chronic kidney disease, atrial
  fibrillation (+ a couple more as the panel dictates). These cover the large
  majority of enrolled patients.
- **Device-technique guides (~5):** BP cuff (already written — ships first), glucose
  meter, weight scale, pulse oximeter, thermometer. High-leverage: bad technique
  produces bad readings, which corrupts everything downstream.
- **App help (~3–5):** taking a reading, syncing, messaging your care team, Face ID.

So **~8–10 articles** for the most common conditions, **~15–25** for solid v1
coverage including device guides and app help. Niche conditions can still deep-link
to MedlinePlus rather than be authored.

**Clinical review is the cost, and it's non-negotiable.** Every article is drafted,
then **reviewed and signed off by a licensed clinician** (the medical director or a
delegated provider) before publish, and stored with reviewer name + date + version.
Re-review on a cadence (annually, or when guidelines change). This is patient-facing
medical guidance under our name — the review process, not the writing, is the real
expense and the real liability boundary.

**Rough cost.** ~15–25 articles × (draft → clinical review → revise) is a few weeks
of focused authoring plus a standing clinical-review commitment, and a small content
store + review/versioning workflow (which #3's backend delivery already builds). The
recurring cost is the review cadence, not the initial write.

**Reading level, concretely.** Target Flesch–Kincaid grade 6, short sentences,
active voice, no jargon (or jargon defined inline), large type friendly. Validate
each article's score before sign-off.

## 3. Delivery: backend-served with a bundled fallback — see the build

The BP guide (and future owned articles) should be **served from the backend** so
content updates don't need an App Store release — BUT with a **bundled fallback
copy**, because an elderly patient is often offline and a guide that fails to load
is worse than a stale one. Ship the baked copy, fetch updates when online, cache the
latest. Details and cost in the build report.
