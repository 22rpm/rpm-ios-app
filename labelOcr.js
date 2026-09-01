// labelOcr.js — capture a medication-bottle label, read it ON-DEVICE (Apple Vision),
// and DISCARD the image immediately (medications step 5). Nothing is stored.
//
// Read order (best → safest):
//   1. BARCODE — an NDC barcode maps to an EXACT product (name, manufactured strength,
//      form). Preferred.
//   2. PRINTED NDC in the text — same exact lookup, no guessing.
//   3. TEXT LINES — no NDC found: hand the recognized lines back so the PATIENT picks
//      the drug-name line. We never guess a name; a confident wrong name is worse than
//      a list to tap.
//
// IMPORTANT: an NDC identifies the PRODUCT, not what the patient takes. Someone
// prescribed half a 50 mg tablet has a bottle whose NDC says 50 mg but a dose of 25 mg.
// So a resolved NDC fills name / strength / form ONLY — dose and frequency are left for
// the patient to set. Never pre-fill a dose from a barcode.
//
// The native MedLabelOCR module reads the file and deletes it (native discard). Camera:
// react-native-image-picker. Requires the native module added to the Xcode target.

import { NativeModules } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { lookupNdc } from './medicationsApi';

const { MedLabelOCR } = NativeModules;

// The dose form ("Oral Capsule", "Tablet") from an RxNorm concept name — for pre-filling
// the Form picker. NOT the strength, and NOT the dose.
export function extractForm(name) {
  const cleaned = (name || '').replace(/\[[^\]]*\]/g, '').trim();
  const m = cleaned.match(/(?:\d+(?:\.\d+)?)\s?(?:mg|mcg|g|ml|%|units?|iu)\b\s*(.*)$/i);
  return m && m[1] ? m[1].trim() : '';
}

// Candidate NDC strings from a barcode payload. Barcodes carry a GTIN/UPC whose NDC
// embedding varies, so we generate a few candidates and let the server validate — a
// wrong guess simply fails the lookup and we fall through to text (never a wrong drug).
function ndcCandidatesFromBarcode(payload) {
  const d = String(payload || '').replace(/\D/g, '');
  const c = new Set();
  if (d.length >= 10 && d.length <= 11) c.add(d);
  if (d.length === 12) { c.add(d.slice(1, 11)); c.add(d.slice(0, 11)); }
  if (d.length === 13) { c.add(d.slice(2, 12)); c.add(d.slice(1, 12)); }
  if (d.length === 14) { c.add(d.slice(3, 13)); c.add(d.slice(2, 13)); }
  return [...c];
}

const NDC_TEXT = /\b\d{4,5}-\d{3,4}-\d{1,2}\b/; // the printed NDC format

async function resolveNdc(barcodes, lines) {
  for (const b of barcodes || []) {
    for (const cand of ndcCandidatesFromBarcode(b.payload)) {
      const r = await lookupNdc(cand);
      if (r && r.name) return r;
    }
  }
  for (const ln of lines || []) {
    const m = ln.match(NDC_TEXT);
    if (m) {
      const r = await lookupNdc(m[0]);
      if (r && r.name) return r;
    }
  }
  return null;
}

// Returns one of:
//   { cancelled: true }
//   { draft: { drug_name, rxcui, route, source:'photo' } }   // NDC hit — NO dose/frequency
//   { lines: [String] }                                       // no NDC — patient picks a line
export async function captureAndReadLabel() {
  if (!MedLabelOCR || typeof MedLabelOCR.recognize !== 'function') {
    const e = new Error('On-device label reading is not available on this build.');
    e.code = 'ocr_unavailable';
    throw e;
  }

  const result = await launchCamera({
    mediaType: 'photo',
    saveToPhotos: false, // do NOT add to the camera roll
    includeBase64: false,
    quality: 0.8,
  });

  if (result?.didCancel) return { cancelled: true };
  if (result?.errorCode) {
    const e = new Error(result.errorMessage || result.errorCode);
    e.code = result.errorCode;
    throw e;
  }
  const uri = result?.assets && result.assets[0]?.uri;
  if (!uri) return { cancelled: true };

  // Native reads the file AND deletes it — the image is gone after this call.
  const { barcodes, lines } = await MedLabelOCR.recognize(uri);

  const ndc = await resolveNdc(barcodes, lines);
  if (ndc) {
    return {
      draft: {
        drug_name: ndc.name, // carries strength + form
        rxcui: ndc.rxcui,
        route: extractForm(ndc.name), // pre-fills the Form picker
        source: 'photo',
        // dose and frequency deliberately absent — the patient sets those.
      },
    };
  }

  // No NDC — let the patient pick the right line. No guessing.
  return { lines: (lines || []).filter((l) => l && l.trim().length >= 3) };
}
