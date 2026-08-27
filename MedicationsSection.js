// MedicationsSection.js — the Medications section inside Profile (SHELL). Lists
// current medications, or an empty state when none, with an "Add" action that opens
// the photo-capture flow. No persistence — this is a pitch of the feature.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import globalStyles from './globalStyles';

const BRAND = globalStyles.primaryColor.color;
const INK = '#2c3e50';
const MUTED = '#7f8c8d';

export default function MedicationsSection({ medications = [], onAdd }) {
  const empty = medications.length === 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title} allowFontScaling>Medications</Text>
        <TouchableOpacity onPress={onAdd} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Add medication">
          <Text style={styles.addBtnText} allowFontScaling>+ Add</Text>
        </TouchableOpacity>
      </View>

      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle} allowFontScaling>No medications yet</Text>
          <Text style={styles.emptyBody} allowFontScaling>
            Add the medicines you take so your care team has an up-to-date list. Tap “Add” and take a
            photo of the label on the bottle — a team member checks it and adds it for you.
          </Text>
        </View>
      ) : (
        medications.map((m) => (
          <View key={m.id} style={styles.medRow}>
            <View style={styles.pill}>
              <Text style={styles.pillGlyph}>💊</Text>
            </View>
            <View style={styles.medBody}>
              <Text style={styles.medName} allowFontScaling>{m.name} {m.dose}</Text>
              <Text style={styles.medFreq} allowFontScaling>{m.frequency}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#ecf0f1',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: INK },
  addBtn: { backgroundColor: BRAND, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  empty: { padding: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: INK, marginBottom: 6 },
  emptyBody: { fontSize: 16, color: MUTED, lineHeight: 23 },

  medRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f3f5' },
  pill: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#eef4f8', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  pillGlyph: { fontSize: 22 },
  medBody: { flex: 1 },
  medName: { fontSize: 18, fontWeight: '700', color: INK },
  medFreq: { fontSize: 15, color: MUTED, marginTop: 2 },
});
