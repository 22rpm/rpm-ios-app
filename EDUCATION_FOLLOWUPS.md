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

## 3. Delivery — BP guide ships via its hosted URL; offline bundle is the follow-up

The BP guide is already published, styled, with step photos + a Spanish version, at
`https://twentytwohealth.com/bp-guide/` (FK grade 5.6 — good for 65+). v1 opens that
URL in the in-app browser (SFSafariViewController), so it's updatable by editing the
website with no App Store release — the backend-served goal, for free.

Open item: it's **online-only**. An elderly patient offline can't load it. Follow-up
for offline: bundle the guide (HTML + assets, or re-authored native ArticleScreen
content) as a fallback when the network fails. Same pattern applies to future owned
articles — hosted/updatable with a bundled fallback.

## 4. TWO sources of truth for "how to take a reading" — host clinical, keep app-UI hardcoded

**The duplication (2026-09-19).** The reading-technique guidance exists in two places that
can drift:
- **Hosted:** `bp-guide` — "How to take your blood pressure" → in-app browser →
  `https://twentytwohealth.com/bp-guide/` (web-updatable, styled, Spanish, step photos).
  Covers "setup, cuff placement, and taking a reading."
- **Hardcoded:** `take-reading` — "Taking a reading in the app" (`helpContent.js`), rendered
  natively by `ArticleScreen`, with its OWN steps ("sit quietly 5 minutes, cuff on the bare
  upper arm, press Start"). This overlaps the hosted guide's technique. Editing the website
  updates the hosted guide but NOT this copy — they silently disagree. Surfaced updating the
  website's "how to take a reading" page.

**The dividing line (decide by CONTENT TYPE, not "education vs help"):**
- **HOST** (single source, web-updatable, with the #3 offline-bundle fallback): clinical /
  health / device-technique content. Reading-level-sensitive, changes independently of the app
  version, benefits from styling/photos/Spanish. → `bp-guide`, and `take-reading`'s technique.
- **KEEP HARDCODED** (ships WITH the matching app build): app-UI / navigation instructions —
  "tap the Readings tab", the "Waiting" status, "tap Messages". These describe THIS build's UI;
  hosting them risks the web copy describing a UI the installed app doesn't have (drift the
  other way). Versioning them with the app is correct, not debt.

**Per-article decision + fix scope:**
- **`take-reading` → HOST it (merge into `bp-guide`).** Its technique already overlaps the
  hosted guide ("taking a reading"). Fix: fold the technique steps into the hosted `bp-guide`
  page, then in `helpContent.js` either delete the `take-reading` item (redundant) or swap its
  `body: [...]` for `url: '<hosted app-help page>'`. Mechanically trivial — `Education.js`
  already routes an item with a `url` to the in-app browser and one with a `body` to
  `ArticleScreen`, so no component change. **Cost: ONE App Store release** (`helpContent.js` is
  in the JS bundle) **+ the website must host the merged content first.** After that release the
  content is web-only forever.
- **`not-syncing` → KEEP HARDCODED.** It's app behavior (the offline outbox / "Waiting" state)
  specific to this build; hosting invites web↔app drift on UI specifics.
- **`messaging` → KEEP HARDCODED.** Pure app-UI ("Messages tab"). Same reasoning.

**The one-release caveat (why not host everything).** Every conversion (`body`→`url`) itself
ships in the JS bundle, so it costs one release; the payoff is only realized on the NEXT content
change. So host the content that actually changes on its own schedule (clinical), and hardcode
the content that only changes when the app UI changes (app-UI). This refines #2's future-article
list: condition + device-technique articles → hosted; app-help that's UI-instructional → in-app.
