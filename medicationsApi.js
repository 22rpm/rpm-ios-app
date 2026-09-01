// medicationsApi.js — patient-side medications API (medications step 3, frontend).
// A patient reports what they take; a clinician confirms it. Nobody prescribes.
//
// Auth mirrors the rest of the app: Bearer token from AsyncStorage plus
// credentials:'include' (the medications routes use the cookie-based authRequired;
// RN persists the login cookie, and the Bearer header is sent too for parity).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './apiConfig';

async function authFetch(path, options = {}) {
  const token = await AsyncStorage.getItem('token');
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* no/invalid JSON body */
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { message: err.message } };
  }
}

// The patient's own reported medications (all states).
export function getMyMedications() {
  return authFetch('/api/medications/mine', { method: 'GET' });
}

export function createMedication(body) {
  return authFetch('/api/medications', { method: 'POST', body: JSON.stringify(body) });
}

// Editing always returns the entry to "unconfirmed" server-side — which is exactly
// how a rejected medication gets corrected and re-submitted for review.
export function updateMedication(id, body) {
  return authFetch(`/api/medications/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteMedication(id) {
  return authFetch(`/api/medications/${id}`, { method: 'DELETE' });
}

// Drug autocomplete (RxNorm-backed). Returns { results, degraded, source }. Never a
// gate: an empty result just means the patient types the name as free text. Public
// endpoint (no auth), so it doesn't depend on session/cookie state.
export async function searchDrugs(q) {
  const res = await authFetch(`/api/medications/drug-search?q=${encodeURIComponent(q)}`, {
    method: 'GET',
  });
  if (res.ok && res.data?.ok) {
    return { results: res.data.results || [], degraded: !!res.data.degraded };
  }
  return { results: [], degraded: true };
}

// NDC -> exact product (barcode / printed-NDC path). Returns { rxcui, name, active } or
// null. The name carries strength + form; the caller must NOT treat strength as the
// patient's dose. Public endpoint.
export async function lookupNdc(ndc) {
  const clean = String(ndc || '').replace(/\D/g, '');
  if (clean.length < 8) return null;
  const res = await authFetch(`/api/medications/ndc/${clean}`, { method: 'GET' });
  if (res.ok && res.data?.ok) return res.data.result || null;
  return null;
}
