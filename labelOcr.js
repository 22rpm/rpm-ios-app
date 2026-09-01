// labelOcr.js — capture a medication-bottle label, read it ON-DEVICE with Apple's
// Vision framework, and DISCARD the image immediately (medications step 5).
//
// Nothing is stored:
//   - launchCamera with saveToPhotos:false  -> the photo is NOT added to the camera roll
//   - the native MedLabelOCR module (Vision) reads the file on-device and DELETES it in
//     native code, success or failure  -> the image never leaves the phone and is not kept
//   - document_key / document_sha256 stay unused (they wait on S3)
//
// OCR is a convenience, not a shortcut past review: the OUTPUT is only a best-effort
// DRAFT the patient must review and correct before submitting. A plausible wrong number
// (25 -> 250) cannot be caught here — correctness comes from the patient confirming the
// draft, then a clinician confirming the entry.
//
// Camera: react-native-image-picker (a reasonable dependency). OCR: no JS dependency —
// the native module MedLabelOCR (ios/VTMDeviceManager/MedLabelOCR.{h,m}) must be added
// to the Xcode target and the app rebuilt. See MEDICATIONS_FOLLOWUPS.md.

import { NativeModules } from 'react-native';
import { launchCamera } from 'react-native-image-picker';

const { MedLabelOCR } = NativeModules;

// Pull a strength like "10 mg" out of recognized text.
function parseStrength(text) {
  const m = (text || '').match(/(\d+(?:\.\d+)?)\s?(mg|mcg|g|ml|%|units?|iu)\b/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : '';
}

// Best-effort drug-name guess: the longest mostly-alphabetic line that isn't obvious
// label boilerplate. Deliberately conservative — the patient fixes it.
const NOISE = /^(take|tablet|tablets|capsule|capsules|oral|by mouth|daily|once|twice|refill|refills|rx|qty|quantity|pharmacy|dr|doctor|use|for|the|each|mfg|lot|exp|ndc)\b/i;
function parseName(text) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[a-z]{4,}/i.test(l) && !NOISE.test(l));
  if (!lines.length) return '';
  lines.sort((a, b) => b.length - a.length);
  return lines[0].slice(0, 120);
}

// Launch the camera, read the label on-device, discard the image (in native), and return
// a draft. Returns { cancelled } if the user backs out, or { draft: { drug_name, dose } }.
export async function captureAndReadLabel() {
  if (!MedLabelOCR || typeof MedLabelOCR.recognize !== 'function') {
    // Native module not present (not added to the target / not rebuilt yet).
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
  const asset = result?.assets && result.assets[0];
  const uri = asset?.uri;
  if (!uri) return { cancelled: true };

  // The native module reads the file AND deletes it — the image is gone after this call.
  const text = await MedLabelOCR.recognize(uri);

  return {
    draft: {
      drug_name: parseName(text),
      dose: parseStrength(text),
      rxcui: null,
      source: 'photo',
    },
  };
}
