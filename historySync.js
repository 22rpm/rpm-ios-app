// Device-history sync — reads the BP cuff's on-device stored readings (its ring
// buffer of up to 50 records) and posts the ones we don't already have, dating each
// to its real MEASUREMENT time (the device's measuring_timestamp), not receipt time.
//
// This is how a reading taken with the app CLOSED reaches the server: the device
// stores it; on the next connect we read it here. Native owns the BLE file-read
// protocol (proven by the 1.0.51 probe); this module owns dedupe, the overlap guard,
// posting, and throttling — all in JS so it's testable without the device.
//
// Durability: the DEVICE is the retention layer. We post one record per request and,
// on any failure, STOP and leave the rest on the device — the next connect re-reads
// and resumes, deduped. There is no separate history queue file.

import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ViatomDeviceManager from './ViatomDeviceManager';
import { DEV_DATA_BASE } from './apiConfig';

const DEV_TYPE = 'bp';

// Persisted set of device filenames (YYYYMMDDHHMMSS, == the record's own key) we have
// already delivered. Used two ways: (1) throttle — the newest name is passed to native
// so it reads only files NEWER than it; (2) idempotency — a record already in the set
// is never re-posted. Capped to the most recent 300 to stay small.
const SYNCED_KEY = 'bp_history_synced_names_v1';
const SYNCED_CAP = 300;

// UTC floor: the phone epoch (seconds) at which this install first synced a device to UTC.
// The device clock is set to UTC on every connect (native utilDeployCompletion), so from
// that first sync onward every reading's measuring_timestamp is UTC epoch. Records stamped
// BEFORE the floor are on the device's old (local / mis-set) clock — we can't trust their
// time, so they are LEGACY: skipped, never posted, never silently corrected. Set once, the
// first time syncHistory runs on a device that has just been UTC-synced.
const UTC_FLOOR_KEY = 'bp_history_utc_floor_v1';

// Overlap guard window. A reading taken with the app OPEN posts LIVE (phone-capture time)
// AND lands in the ring (device measuring_timestamp). With the device clock on UTC, the two
// times now share a base; the only residual gap is measurement/transmission delay (live
// time is baked when the phone RECEIVES the result, ~30-60s after the device stamps it) plus
// ~1s rounding. 120s covers that with margin. The exact (sys,dia,pulse) triple match is the
// real discriminator; one-to-one matching caps damage (each live row absorbs one ring
// record). TUNABLE.
const OVERLAP_WINDOW_S = 120;

// Guard against overlapping syncs (connect + focus can fire close together).
let syncing = false;

async function loadSyncedNames() {
  try {
    const raw = await AsyncStorage.getItem(SYNCED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    console.warn('[histSync] loadSyncedNames failed, starting empty:', e?.message);
    return new Set();
  }
}

async function saveSyncedNames(set) {
  try {
    // Keep the most recent SYNCED_CAP names (lexical sort == chronological for
    // YYYYMMDDHHMMSS), so the store can't grow without bound.
    const sorted = Array.from(set).sort();
    const capped = sorted.slice(Math.max(0, sorted.length - SYNCED_CAP));
    await AsyncStorage.setItem(SYNCED_KEY, JSON.stringify(capped));
  } catch (e) {
    console.warn('[histSync] saveSyncedNames failed:', e?.message);
  }
}

// Return the UTC floor (epoch s), initializing it to `nowS` on first ever run. Because the
// device was just UTC-synced this connect, `nowS` is the earliest instant we can vouch the
// device clock is UTC — so readings stamped at/after it are trustworthy, earlier ones legacy.
async function loadOrInitUtcFloor(nowS) {
  try {
    const raw = await AsyncStorage.getItem(UTC_FLOOR_KEY);
    const stored = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(stored) && stored > 0) return stored;
    await AsyncStorage.setItem(UTC_FLOOR_KEY, String(nowS));
    return nowS;
  } catch (e) {
    console.warn('[histSync] utc floor load/init failed, using now:', e?.message);
    return nowS;
  }
}

function maxName(set) {
  let m = '';
  for (const n of set) if (n > m) m = n;
  return m;
}

// Trigger native to read the stored records newer than `sinceName`, and resolve with
// the parsed record array. Native emits `onHistorySync` possibly twice: a header event
// (fileCount/fileNames, no `records`) and a final batch event (with `records`). Resolves
// on the batch, or early with [] on device disconnect (the read cannot finish once the
// cuff is gone — e.g. it powers off mid-read), or on a bounded timeout as a last-resort
// backstop for a read that stalls while still connected. NEVER hangs: a mid-sync
// disconnect resolves in ~1 BLE callback, not after the full timeout.
//
// `reason` = 'records' | 'disconnect' | 'timeout' | 'wrapper-missing' | 'threw'.
//
// timeoutMs is a GENEROUS backstop, not the primary guard: a full 50-file read is many
// BLE round-trips and can legitimately take ~60-90s, so a tight timeout would abort a
// working read. The disconnect handler is what makes the common failure (cuff powered
// off / out of range) resolve fast; the timeout only catches a stall while still linked.
function readRecords(sinceName, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (recs, reason) => {
      if (done) return;
      done = true;
      try { subHistory && subHistory.remove && subHistory.remove(); } catch (e) {}
      try { subDisconnect && subDisconnect.remove && subDisconnect.remove(); } catch (e) {}
      clearTimeout(timer);
      resolve({ records: Array.isArray(recs) ? recs : [], reason });
    };
    const subHistory = ViatomDeviceManager.addListener('onHistorySync', (evt) => {
      if (evt && Array.isArray(evt.records)) finish(evt.records, 'records');
    });
    // Device gone mid-read (powered off, out of range, cuff died): native will emit no
    // further onHistorySync, so bail immediately instead of waiting out the timeout.
    // Whatever wasn't read stays on the device and resumes on the next connect.
    const subDisconnect = ViatomDeviceManager.addListener('onDeviceDisconnected', () => {
      console.warn('[histSync] device disconnected mid-read — aborting, records stay on device');
      finish([], 'disconnect');
    });
    const timer = setTimeout(() => {
      console.warn('[histSync] read timed out — leaving records on device for next connect');
      finish([], 'timeout');
    }, timeoutMs);
    // Guard the JS whitelist wrapper: if syncStoredRecords isn't forwarded, the call is a
    // silent no-op (see ViatomDeviceManager.js maintenance rule — this bit us once).
    if (typeof ViatomDeviceManager.syncStoredRecords !== 'function') {
      console.warn('[histSync] WRAPPER is missing syncStoredRecords — update ViatomDeviceManager.js');
      return finish([], 'wrapper-missing');
    }
    try {
      ViatomDeviceManager.syncStoredRecords?.(sinceName || '');
    } catch (e) {
      console.warn('[histSync] syncStoredRecords threw:', e?.message);
      finish([], 'threw');
    }
  });
}

// A record is deliverable only if it's a completed BP reading: status 0, non-zero
// pressures, real timestamp. status!=0 or 0/0 are device error/placeholder rows.
function isValidRecord(r) {
  return (
    r &&
    Number(r.recordStatus) === 0 &&
    Number(r.recordTs) > 0 &&
    !(Number(r.recordSys) === 0 && Number(r.recordDia) === 0)
  );
}

async function fetchServerRows(days) {
  try {
    const res = await axios.get(
      `${DEV_DATA_BASE}/devices/getUserReadingData?deviceType=bp&days=${days}`,
      { withCredentials: true, timeout: 8000 }
    );
    const recs = (res && res.data && res.data.success && res.data.data && res.data.data.records) || [];
    return recs.map((row) => {
      const d = row.data || {};
      // Prefer the measurement time we now store (measured_at, epoch s); fall back to
      // the client timestamp, then the server receipt time. Only used to pair a ring
      // record with an already-delivered reading, so an approximate time is fine.
      let ts = Number(d.measured_at);
      if (!Number.isFinite(ts) || ts <= 0) {
        const t = Date.parse(d.timestamp || row.createdAt);
        ts = Number.isNaN(t) ? 0 : Math.floor(t / 1000);
      }
      return {
        key: row.id,
        ts,
        sys: Number(d.systolic),
        dia: Number(d.diastolic),
        pulse: Number(d.pulse),
      };
    });
  } catch (e) {
    // No server list => no overlap guard. Safer to skip the sync than to post blind
    // duplicates of every live reading; the device retains the records for next time.
    console.warn('[histSync] server list fetch failed, skipping this sync:', e?.response?.status || e?.message);
    return null;
  }
}

// One-to-one overlap guard. Each server row can absorb AT MOST ONE ring record, so a
// single live reading can never suppress two genuine ring records. Ring records are
// matched oldest-first to the nearest unconsumed server row with identical values
// within OVERLAP_WINDOW_S. Every drop is logged with both sides so testing can see
// exactly what was suppressed and why.
// Matches on `recordTs` directly: the device clock is UTC, so measuring_timestamp already
// shares a base with the live server rows' measured_at. See OVERLAP_WINDOW_S for the budget.
function applyOverlapGuard(fresh, serverRows) {
  const consumed = new Set();
  const survivors = [];
  const droppedNames = [];
  const sorted = [...fresh].sort((a, b) => a.recordTs - b.recordTs);
  for (const r of sorted) {
    let best = null;
    let bestDelta = Infinity;
    for (const s of serverRows) {
      if (consumed.has(s.key)) continue;
      if (s.sys !== Number(r.recordSys) || s.dia !== Number(r.recordDia) || s.pulse !== Number(r.recordPulse)) continue;
      const delta = Math.abs(s.ts - Number(r.recordTs));
      if (delta <= OVERLAP_WINDOW_S && delta < bestDelta) {
        best = s;
        bestDelta = delta;
      }
    }
    if (best) {
      consumed.add(best.key);
      droppedNames.push(String(r.recordName));
      console.log(
        `[histSync] DROP (overlap) ring ${r.recordName} ` +
        `${r.recordSys}/${r.recordDia} p${r.recordPulse} ts=${r.recordTs} ` +
        `(${new Date(Number(r.recordTs) * 1000).toISOString()}) ` +
        `matched server row id=${best.key} ${best.sys}/${best.dia} p${best.pulse} ` +
        `ts=${best.ts} (${new Date(best.ts * 1000).toISOString()}) delta=${bestDelta}s`
      );
    } else {
      survivors.push(r);
    }
  }
  return { survivors, droppedNames };
}

function buildBody(r, device) {
  // Device clock is UTC, so measuring_timestamp (recordTs) IS the UTC measurement time.
  const iso = new Date(Number(r.recordTs) * 1000).toISOString();
  return {
    devId: (device && device.id) || 'bp_device_001',
    devType: DEV_TYPE,
    data: {
      systolic: Number(r.recordSys),
      diastolic: Number(r.recordDia),
      pulse: Number(r.recordPulse),
      mean: Number(r.recordMean),
      // Deterministic per reading: the server dedups on (user, dev_type, timestamp),
      // so re-posting the same ring record is a no-op even if local state is lost.
      timestamp: iso,
      measured_at: Number(r.recordTs), // epoch s — UTC measurement time (device clock is UTC)
      // Audit trail: keep the raw device measuring_timestamp so the stored value is always
      // traceable to what the device reported, even if the clock policy changes later.
      raw_ts: Number(r.recordTs),
      date: undefined,
      time: undefined,
      source: 'history',
      deviceInfo: {
        name: (device && device.name) || 'Blood Pressure Monitor',
        id: (device && device.id) || 'unknown_device_id',
        type: 'viatom',
      },
    },
  };
}

function isConfirmedSuccess(res) {
  return res && res.status >= 200 && res.status < 300 && res.data && res.data.success === true;
}

// Read the device's stored readings and deliver the ones we don't already have.
// `device` = { id, name } of the connected cuff. `onProgress(posted, total)` is optional.
// Returns { posted, dropped, kept, skipped } — never throws.
export async function syncHistory(device, { days = 30, onProgress } = {}) {
  if (syncing) return { skipped: 'in-progress' };
  syncing = true;
  try {
    const synced = await loadSyncedNames();
    const sinceName = maxName(synced);

    const { records, reason } = await readRecords(sinceName);
    if (!records.length) {
      // read-<reason>: disconnect / timeout / wrapper-missing / threw / no-records. Never hangs.
      return { posted: 0, dropped: 0, kept: 0, skipped: `read-${reason || 'empty'}` };
    }

    const valid = records.filter(isValidRecord);
    // Drop anything we've already delivered (idempotency / re-read of the same ring).
    const fresh = valid.filter((r) => !synced.has(String(r.recordName)));
    if (!fresh.length) return { posted: 0, dropped: 0, kept: 0, skipped: 'all-already-synced' };

    // Clock scoping: the device clock is set to UTC on connect, so recordTs is UTC epoch.
    // Trust only readings stamped at/after this install's first UTC sync (utcFloor); earlier
    // ring records are on the device's old local clock — LEGACY: skipped, never posted, never
    // silently corrected. Then sanity-bound (no future / not absurdly old). Records older than
    // the floor also fall below `sinceName` once anything newer posts, so the throttle stops
    // re-reading them — the skip is self-limiting.
    const nowS = Math.floor(Date.now() / 1000);
    const utcFloor = await loadOrInitUtcFloor(nowS);
    const MAX_FUTURE_S = 300;            // allow small skew
    const MAX_AGE_S = 400 * 24 * 3600;   // ~13 months
    let legacy = 0;
    let outOfBounds = 0;
    const datable = [];
    for (const r of fresh) {
      const ts = Number(r.recordTs);
      if (ts < utcFloor) { legacy += 1; continue; }                    // pre-UTC-sync, not datable
      if (ts > nowS + MAX_FUTURE_S || ts < nowS - MAX_AGE_S) {
        outOfBounds += 1;
        console.warn(`[histSync] SANITY skip ${r.recordName}: ts=${ts} ` +
          `(${new Date(ts * 1000).toISOString()}) out of bounds`);
        continue;
      }
      datable.push(r);
    }
    if (legacy) console.log(`[histSync] ${legacy} legacy pre-UTC-sync record(s) skipped (not datable)`);
    if (!datable.length) {
      return { posted: 0, dropped: 0, kept: 0, legacy, outOfBounds,
               skipped: legacy ? 'all-legacy' : 'all-out-of-bounds' };
    }

    const serverRows = await fetchServerRows(days);
    if (serverRows === null) {
      return { posted: 0, dropped: 0, kept: datable.length, legacy, skipped: 'no-server-list' };
    }

    const { survivors, droppedNames } = applyOverlapGuard(datable, serverRows);
    survivors.sort((a, b) => a.recordTs - b.recordTs);
    const dropped = droppedNames.length;

    let posted = 0;
    let kept = 0;
    let completed = true;
    for (let i = 0; i < survivors.length; i++) {
      const r = survivors[i];
      try {
        const res = await axios.post(`${DEV_DATA_BASE}/devices/data`, buildBody(r, device), {
          withCredentials: true,
          headers: { 'Content-Type': 'application/json' },
          timeout: 8000,
        });
        if (isConfirmedSuccess(res)) {
          synced.add(String(r.recordName));
          posted += 1;
          if (onProgress) onProgress(posted, survivors.length);
        } else {
          // Ambiguous — leave it and the rest on the device; stop so we don't spray
          // POSTs at a failing server. Next connect resumes.
          console.warn('[histSync] ambiguous response, stopping', r.recordName, res && res.status);
          kept = survivors.length - posted;
          completed = false;
          break;
        }
      } catch (e) {
        console.warn('[histSync] post failed, stopping (device retains rest):', r.recordName, e?.response?.status || e?.message);
        kept = survivors.length - posted;
        completed = false;
        break;
      }
    }

    // THROTTLE: only when the run finished with NO post failure, mark the overlap-dropped
    // records synced too. They're already on the server (they matched a live-posted row),
    // so they never need posting — recording them stops the next connect from re-reading
    // and re-dropping the same files over BLE every time. On a failure we skip this: the
    // device still retains them and the next clean run resolves them.
    if (completed) {
      for (const n of droppedNames) synced.add(n);
    }

    await saveSyncedNames(synced);
    console.log(`[histSync] done: posted=${posted} dropped=${dropped} kept=${kept} legacy=${legacy}`);
    return { posted, dropped, kept, legacy };
  } finally {
    syncing = false;
  }
}
