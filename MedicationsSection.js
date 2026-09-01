// MedicationsSection.js — the Medications section inside Profile (medications step 3,
// frontend). Shows the patient's reported medications and their review state, and lets
// them add or correct one. A patient reports what they take; a clinician confirms it.
//
// Elderly-facing wording is deliberate:
//   - CONFIRMED   → quiet: "Confirmed by your care team".
//   - UNCONFIRMED → this is the NORMAL state right after entry, NOT an error. The copy
//     says the care team will check it — never "pending" or anything that reads as
//     "you did something wrong". Calm colour, not an alarm.
//   - REJECTED    → the patient must act, framed kindly: the care team's actionable
//     reason is shown, with an obvious "Update this medication" button that opens the
//     entry form pre-filled (saving re-submits it for review). A red badge alone is not
//     enough — the whole point of the reason being actionable is giving them a way to fix it.

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import globalStyles from './globalStyles';
import { getMyMedications } from './medicationsApi';

const BRAND = globalStyles.primaryColor.color; // #014e6b
const INK = '#1f2d3d';
const MUTED = '#5b6b7a';

export default function MedicationsSection({ navigation }) {
  const [meds, setMeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const res = await getMyMedications();
    if (res.ok && res.data?.ok) {
      setMeds(res.data.medications || []);
      setError(false);
    } else {
      setError(true);
    }
    setLoading(false);
  }, []);

  // Refresh whenever the screen regains focus (e.g. returning from add/edit).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goAdd = () => navigation.navigate('MedicationEntry');
  const goEdit = (m) => navigation.navigate('MedicationEntry', { medication: m });

  const empty = !loading && meds.length === 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title} allowFontScaling>Medications</Text>
        <TouchableOpacity onPress={goAdd} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Add a medication">
          <Text style={styles.addBtnText} allowFontScaling>+ Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyBody} allowFontScaling>
            We couldn't load your medications right now. Please try again in a moment.
          </Text>
        </View>
      ) : empty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle} allowFontScaling>No medications yet</Text>
          <Text style={styles.emptyBody} allowFontScaling>
            Tap “Add” to enter a medicine you take. Your care team will check it and add it to your list.
          </Text>
        </View>
      ) : (
        meds.map((m) => <MedRow key={m.id} m={m} onEdit={() => goEdit(m)} />)
      )}
    </View>
  );
}

function MedRow({ m, onEdit }) {
  const rejected = m.status === 'rejected';
  const confirmed = m.status === 'confirmed';
  const detail = [m.dose, m.route, m.frequency].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      style={styles.medRow}
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`${m.drug_name}. Tap to edit.`}
      activeOpacity={0.7}
    >
      <View style={styles.medRowTop}>
        <View style={styles.pill}>
          <Text style={styles.pillGlyph}>💊</Text>
        </View>
        <View style={styles.medBody}>
          <Text style={styles.medName} allowFontScaling>{m.drug_name}</Text>
          {!!detail && <Text style={styles.medDetail} allowFontScaling>{detail}</Text>}

          {/* State line — CONFIRMED quiet, UNCONFIRMED reassuring, REJECTED actionable. */}
          {confirmed ? (
            <View style={[styles.statusRow]}>
              <Text style={[styles.statusText, styles.statusConfirmed]} allowFontScaling>
                ✓ Confirmed by your care team
              </Text>
            </View>
          ) : rejected ? null : (
            <View style={styles.statusRow}>
              <Text style={[styles.statusText, styles.statusChecking]} allowFontScaling>
                Your care team will check this
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Rejected: show the actionable reason and an obvious way to fix it. */}
      {rejected && (
        <View style={styles.rejectBox}>
          <Text style={styles.rejectTitle} allowFontScaling>Please double-check this</Text>
          {!!m.reject_reason && (
            <Text style={styles.rejectReason} allowFontScaling>{m.reject_reason}</Text>
          )}
          <TouchableOpacity
            style={styles.fixBtn}
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Update ${m.drug_name}`}
          >
            <Text style={styles.fixBtnText} allowFontScaling>Update this medication</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', marginHorizontal: 15, marginBottom: 20, borderRadius: 16,
    overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 3.84, elevation: 5,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, backgroundColor: '#f8f9fa', borderBottomWidth: 1, borderBottomColor: '#ecf0f1',
  },
  title: { fontSize: 19, fontWeight: 'bold', color: INK },
  addBtn: { backgroundColor: BRAND, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  loading: { padding: 26, alignItems: 'center' },
  empty: { padding: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: INK, marginBottom: 6 },
  emptyBody: { fontSize: 16, color: MUTED, lineHeight: 23 },

  medRow: { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f1f3f5' },
  medRowTop: { flexDirection: 'row', alignItems: 'flex-start' },
  pill: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#eef4f8', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  pillGlyph: { fontSize: 22 },
  medBody: { flex: 1 },
  medName: { fontSize: 18, fontWeight: '700', color: INK },
  medDetail: { fontSize: 16, color: MUTED, marginTop: 2, lineHeight: 22 },

  statusRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center' },
  statusText: { fontSize: 15, fontWeight: '600' },
  statusConfirmed: { color: '#1c7c4a' },
  // Calm, informational — deliberately NOT amber/red. This is the normal state.
  statusChecking: { color: '#0a6c86' },

  rejectBox: {
    marginTop: 12, backgroundColor: '#fff4e5', borderWidth: 1.5, borderColor: '#f0b660',
    borderRadius: 12, padding: 14,
  },
  rejectTitle: { fontSize: 17, fontWeight: '800', color: '#8a5300', marginBottom: 4 },
  rejectReason: { fontSize: 16, color: '#5b4322', lineHeight: 23, marginBottom: 12 },
  fixBtn: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  fixBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
