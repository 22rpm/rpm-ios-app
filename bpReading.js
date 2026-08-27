// bpReading.js — resolve the freshest BP reading + its real sync state, shared by
// PatientHome, Readings, and the reading reminder.
//
// A reading still in the durable outbox (getPendingResults) has NOT been confirmed
// by the server, so it is the newest truth and its pill is "Waiting". Otherwise the
// server's latest is the newest and it is "Synced". Either way the patient HAS taken
// a reading — `takenToday` is true if that reading is from today, so the reminder
// never nags someone who already measured (delivery lag is our problem, not theirs).
//
// Returns { value, unit, status:'waiting'|'synced', time, at, takenToday } or null.

import axios from 'axios';
import ViatomDeviceManager from './ViatomDeviceManager';
import { DEV_DATA_BASE } from './apiConfig';
import { relativeTime, isToday } from './vitals';

export async function loadBpReading() {
  let pending = [];
  try {
    pending = (await ViatomDeviceManager.getPendingResults()) || [];
  } catch (e) {
    pending = [];
  }

  // Newest queued (undelivered) reading, if any.
  const queued = pending
    .filter((r) => r && r.systolic != null && r.diastolic != null)
    .sort((a, b) => (b.enqueuedAt || 0) - (a.enqueuedAt || 0))[0];

  if (queued) {
    const at = queued.enqueuedAt || Date.parse(queued.timestamp);
    return {
      value: `${queued.systolic}/${queued.diastolic}`,
      unit: 'mmHg',
      status: 'waiting',
      time: relativeTime(at),
      at,
      takenToday: isToday(at),
    };
  }

  // No queued reading — the server's latest, as Synced.
  try {
    const res = await axios.get(
      `${DEV_DATA_BASE}/devices/data/latest?deviceType=bp`,
      { withCredentials: true }
    );
    if (res.data && res.data.success && res.data.data) {
      const v = res.data.data.data || {};
      // Reading time = data.timestamp (native iso8601Now: a UTC "…Z" string stored as
      // JSON, so it's immune to the tz mishandling). `createdAt` is the outbox DELIVERY
      // time, not the reading time — wrong field, AND served ~7h off on the dev box
      // (Pacific SYSTEM session + config/db.js `timezone:'Z'` mislabels the TIMESTAMP).
      // On prod (UTC session) the 7h is invisible for immediate deliveries, but a
      // reading taken offline and delivered later still shows the delivery time. Fall
      // back to createdAt only for a legacy row with no baked timestamp.
      const at = v.timestamp || res.data.data.createdAt;
      if (v.systolic != null && v.diastolic != null) {
        return {
          value: `${v.systolic}/${v.diastolic}`,
          unit: 'mmHg',
          status: 'synced',
          time: relativeTime(at),
          at,
          takenToday: isToday(at),
        };
      }
    }
  } catch (e) {
    // Fall through to null.
  }
  return null;
}
