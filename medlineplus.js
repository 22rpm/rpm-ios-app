// medlineplus.js — patient-education links from MedlinePlus Connect (NLM/NIH): free,
// public-domain, code-driven, no key. Called with a diagnosis code.
//
// We HARDCODE hypertension (ICD-10 I10) because the patient record stores no
// diagnosis code — so every patient gets the same articles until that gap is fixed.
// See EDUCATION_FOLLOWUPS.md #1. When a code is stored, pass it in here.
//
// Returns [{ id, title, summary, url }]. Never throws — [] on any failure so the
// Education tab degrades gracefully offline.

const ICD10_CS = '2.16.840.1.113883.6.90'; // ICD-10-CM code system OID
const HYPERTENSION = 'I10';
const ENDPOINT = 'https://connect.medlineplus.gov/service';

function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstHref(link) {
  if (Array.isArray(link)) return link[0] && link[0].href;
  if (link && typeof link === 'object') return link.href;
  return null;
}

function value(field) {
  if (field == null) return '';
  return typeof field === 'object' ? field._value || field.value || '' : field;
}

export async function fetchEducationArticles(code = HYPERTENSION) {
  const url =
    `${ENDPOINT}?mainSearchCriteria.v.cs=${ICD10_CS}` +
    `&mainSearchCriteria.v.c=${encodeURIComponent(code)}` +
    `&knowledgeResponseType=application/json`;
  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    const raw = (data && data.feed && data.feed.entry) || [];
    const entries = Array.isArray(raw) ? raw : [raw];
    return entries
      .map((e, i) => {
        const href = firstHref(e.link);
        return href
          ? { id: String(i), title: String(value(e.title)).trim(), summary: stripHtml(value(e.summary)), url: href }
          : null;
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}
