// vitals.js — the vital catalog + which vitals the patient is enrolled for, shared
// by PatientHome, Readings, and the reading reminder so the three never drift.
//
// `enrolled` is hardcoded bp-only for now: only bp is is_active + verified against
// real dev_data, and the per-patient enrollment table (rpm_device_setups) isn't on
// prod yet. When enrollment ships, source `enrolled` (and the enrolled set) from the
// patient's real rows. See EDUCATION_FOLLOWUPS.md #1 and PatientHome's header.

export const VITALS = [
  { key: 'bp',      name: 'Blood Pressure', unit: 'mmHg',  icon: require('./assets/BP.png'), enrolled: true,  route: 'BloodPressure', reminderNoun: 'blood pressure' },
  { key: 'glucose', name: 'Blood Glucose',  unit: 'mg/dL', icon: require('./assets/BG.png'), enrolled: false, route: null,           reminderNoun: 'blood glucose' },
  { key: 'spo2',    name: 'Oxygen (SpO₂)',  unit: '%',     icon: require('./assets/OS.png'), enrolled: false, route: null,           reminderNoun: 'oxygen' },
  { key: 'weight',  name: 'Weight',         unit: 'lbs',   icon: require('./assets/W.png'),  enrolled: false, route: null,           reminderNoun: 'weight' },
  { key: 'temp',    name: 'Temperature',    unit: '°F',    icon: require('./assets/T.png'),  enrolled: false, route: null,           reminderNoun: 'temperature' },
];

export const ENROLLED_VITALS = VITALS.filter((v) => v.enrolled);

function toMillis(input) {
  const t = typeof input === 'number' ? input : Date.parse(input);
  return !t || isNaN(t) ? null : t;
}

// Elderly-friendly, glanceable freshness.
export function relativeTime(input) {
  const t = toMillis(input);
  if (t == null) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return 'Just now';
  const mins = Math.floor(diff / (60 * 1000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(diff / (60 * 60 * 1000));
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}

// Local-day comparison. "Taken today" keys off the device's local calendar day.
export function isToday(input) {
  const t = toMillis(input);
  if (t == null) return false;
  const d = new Date(t);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// "8:14 AM" — for the reminder's done state.
export function clockTime(input) {
  const t = toMillis(input);
  if (t == null) return '';
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
