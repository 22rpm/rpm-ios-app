// Durable BP-reading outbox — drain side.
//
// Native persists a reading to an on-disk queue the instant it is parsed (before
// any JS notification). This module is the delivery side: it POSTs each queued
// reading and removes a row ONLY on a confirmed server success. A timeout, a
// 4xx/401, a 5xx, or being offline leaves the row queued for the next drain.
//
// Server idempotency keys on (user_id, dev_type, data.timestamp), and the
// timestamp was baked ONCE by native at parse time, so every attempt for a given
// reading carries the same key. Over-retrying is therefore free (the server
// dedups); premature deletion would lose a reading. That asymmetry is why we only
// delete on an explicit success and keep the row on everything else.

import axios from 'axios';
import ViatomDeviceManager from './ViatomDeviceManager';
import { DEV_DATA_BASE } from './apiConfig';

const DEV_TYPE = 'bp';

// Guard against overlapping drains (focus + app-start + post-reading can fire
// close together). Not correctness-critical — the server would dedup — but it
// avoids redundant POSTs of the same row.
let draining = false;

function buildBody(rec) {
  const d = new Date(rec.timestamp);
  const valid = !isNaN(d.getTime());
  return {
    // Native binds the real device UUID at measurement time; the literal is only
    // a last-resort fallback for a record with no device id.
    devId: rec.devId || 'bp_device_001',
    devType: DEV_TYPE,
    data: {
      systolic: rec.systolic,
      diastolic: rec.diastolic,
      pulse: rec.pulse,
      mean: rec.mean,
      timestamp: rec.timestamp, // baked by native — the dedup key
      date: valid ? d.toLocaleDateString() : undefined,
      time: valid ? d.toLocaleTimeString() : undefined,
      deviceInfo: {
        name: rec.devName || 'Blood Pressure Monitor',
        id: rec.devId || 'unknown_device_id',
        type: 'viatom',
      },
    },
  };
}

// A delete is allowed only on a confirmed server success: a 2xx AND an explicit
// { success: true } body. This API returns 201 on store AND on an idempotent
// duplicate, so a deduped reading is correctly treated as delivered. Anything
// else (network error, 401, 4xx, 5xx, timeout — all of which reject or lack
// success) keeps the row.
function isConfirmedSuccess(res) {
  return res && res.status >= 200 && res.status < 300 && res.data && res.data.success === true;
}

// Drain the outbox. Safe to call from anywhere, any number of times.
export async function drainOutbox() {
  if (draining) return { skipped: true };
  draining = true;
  let sent = 0;
  let kept = 0;
  try {
    const pending = (await ViatomDeviceManager.getPendingResults()) || [];
    if (pending.length === 0) return { sent: 0, kept: 0 };

    console.log(`[outbox] draining ${pending.length} queued reading(s)`);
    for (const rec of pending) {
      try {
        const res = await axios.post(`${DEV_DATA_BASE}/devices/data`, buildBody(rec), {
          withCredentials: true,
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        });
        if (isConfirmedSuccess(res)) {
          await ViatomDeviceManager.clearPendingResult(rec.id);
          sent += 1;
        } else {
          kept += 1;
          console.warn('[outbox] ambiguous response, keeping row', rec.id, res && res.status);
        }
      } catch (e) {
        kept += 1;
        console.warn('[outbox] delivery failed, keeping row', rec.id, e?.response?.status || e?.message);
      }
    }
  } catch (e) {
    console.warn('[outbox] drain error', e?.message);
  } finally {
    draining = false;
  }
  return { sent, kept };
}

// Age (ms) of the oldest undelivered reading, or 0 if the queue is empty. For a
// future staleness surface (see the notes handed to the product owner): a reading
// sitting here for ~a day means delivery is silently failing.
export async function oldestPendingAgeMs() {
  try {
    const pending = (await ViatomDeviceManager.getPendingResults()) || [];
    if (pending.length === 0) return 0;
    const now = Date.now();
    return pending.reduce((max, r) => Math.max(max, now - (r.enqueuedAt || now)), 0);
  } catch (e) {
    return 0;
  }
}
