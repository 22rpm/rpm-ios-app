// helpContent.js — the Education tab's Help section content.
//
// The BP guide slots in as the FIRST item. Its content is being provided
// separately (the owned guide: cuff placement, positioning), so it's `pending` for
// now — the slot is ready. When the content arrives, drop it into `bp-guide` (either
// inline `body` paragraphs, or switch to a bundled/fetched HTML article — see the
// build report on bundled-vs-backend). The other items are basic app help, authored
// here in plain language for 65+.
//
// `body` is an array of short paragraphs rendered by ArticleScreen.

export const HELP_ARTICLES = [
  {
    id: 'bp-guide',
    title: 'How to take your blood pressure',
    subtitle: 'Step-by-step: setup, cuff placement, and taking a reading',
    // Owned guide, already hosted (styled, with step photos + a Spanish version).
    // Opens in the in-app browser so it's updatable via the website, no app release.
    // KEEP THIS AT /bp-guide/ — do not deep-link to a platform/language path.
    // Routing (phone, then language) is handled on the website side, so where a
    // patient lands can change without an App Store build. A deep link here would
    // pin the destination to whatever the site looked like at release time.
    url: 'https://twentytwohealth.com/bp-guide/',
  },
  {
    id: 'take-reading',
    title: 'Taking a reading in the app',
    body: [
      'Open the Readings tab and tap Blood Pressure.',
      'Sit quietly for 5 minutes first, with your feet flat on the floor and your back supported.',
      'Put the cuff on your bare upper arm and press Start on the device.',
      'Stay still and quiet while it inflates. Your reading appears in the app and sends to your care team on its own.',
    ],
  },
  {
    id: 'not-syncing',
    title: 'If your reading doesn’t appear',
    body: [
      'Your reading is saved on your phone even if it doesn’t send right away — you won’t lose it.',
      'Open the app while you have Wi-Fi or cell service and it sends by itself.',
      'A reading marked “Waiting” has been saved and will send when you’re back online. You don’t need to take it again.',
    ],
  },
  // 'messaging' REMOVED for 1.0.50: it told patients to tap a Messages tab, and
  // Messages was pulled from this release (see PatientHome.js NAV_ITEMS). Re-add it
  // with the tab, not before — help that names a button the app doesn't have sends
  // the patient hunting.
];

export function findHelpArticle(id) {
  return HELP_ARTICLES.find((a) => a.id === id) || null;
}
