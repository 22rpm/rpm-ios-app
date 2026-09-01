// labelOcr.js — capture a medication-bottle label, read it ON-DEVICE, and DISCARD the
// image immediately (medications step 5). Nothing is stored:
//   - launchCamera with saveToPhotos:false  -> the photo is NOT added to the camera roll
//   - ML Kit text recognition runs fully on-device  -> the image never leaves the phone
//   - the temp file is unlinked in a `finally`  -> deleted right after the read, even on error
// The document_key / document_sha256 columns stay unused (they wait on S3).
//
// The OUTPUT is only a best-effort DRAFT the patient must review and correct before
// submitting — OCR misreads drug names and strengths, and a plausible wrong number
// (25 -> 250) cannot be caught here. Correctness comes from the patient confirming the
// draft, then a clinician confirming the entry. This function never saves anything to
// the record; it only returns fields to pre-fill the entry form.
//
// Requires native modules (installed as part of the device build):
//   react-native-image-picker, @react-native-ml-kit/text-recognition, react-native-fs
// plus NSCameraUsageDescription in ios Info.plist. See MEDICATIONS_FOLLOWUPS.md.

import { launchCamera } from 'react-native-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import RNFS from 'react-native-fs';

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
  // Prefer a line with letters but not mostly digits; pick the longest such.
  lines.sort((a, b) => b.length - a.length);
  return lines[0].slice(0, 120);
}

async function discard(uri) {
  if (!uri) return;
  try {
    const path = uri.replace(/^file:\/\//, '');
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  } catch {
    /* best-effort delete; never surface a cleanup failure to the patient */
  }
}

// Launch the camera, read the label on-device, discard the image, and return a draft.
// Returns { cancelled } if the user backs out, or { draft: { drug_name, dose } }.
export async function captureAndReadLabel() {
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

  try {
    const recognized = await TextRecognition.recognize(uri);
    const text = recognized?.text || '';
    return {
      draft: {
        drug_name: parseName(text),
        dose: parseStrength(text),
        rxcui: null,
        source: 'photo',
      },
    };
  } finally {
    // Discard the image immediately — success or failure.
    await discard(uri);
  }
}
