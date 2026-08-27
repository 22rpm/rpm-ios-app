// VitalCard.js — one vital's card (icon, name, value+unit, sync pill), shared by
// PatientHome and Readings so the two card lists stay identical.
//
// Enrolled + has a reading  -> value + Synced/Waiting pill, tappable.
// Enrolled + no reading yet  -> "No readings yet".
// Not enrolled               -> greyed, non-interactive, neutral "Not included"
//                               (reads as "not part of your plan", never "broken").
//
// Vital icons are finished full-color circular art (white line-art on a teal
// gradient) — rendered as-is: NO tintColor (which flattens them to a solid blob)
// and NO background wrapper (they carry their own circle).

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import globalStyles from './globalStyles';

const INK = '#103c63';
const MUTED = '#5b6b78';
const NAV_INACTIVE = '#9aa5ac';

export default function VitalCard({ vital, reading, onPress }) {
  if (!vital.enrolled) {
    return (
      <View
        style={[styles.card, styles.cardInactive]}
        accessible
        accessibilityLabel={`${vital.name}, not included`}
      >
        <Image source={vital.icon} style={[styles.cardIcon, styles.cardIconInactive]} resizeMode="contain" />
        <View style={styles.cardBody}>
          <Text style={[styles.cardName, styles.cardNameInactive]} allowFontScaling>
            {vital.name}
          </Text>
        </View>
        <View style={[styles.pill, styles.pillIdle]}>
          <Text style={[styles.pillText, styles.pillTextIdle]}>Not included</Text>
        </View>
      </View>
    );
  }

  const hasReading = !!reading;
  const isWaiting = hasReading && reading.status === 'waiting';
  const Card = onPress ? TouchableOpacity : View;

  return (
    <Card activeOpacity={0.7} onPress={onPress || undefined} style={styles.card}>
      <Image source={vital.icon} style={styles.cardIcon} resizeMode="contain" />

      <View style={styles.cardBody}>
        <Text style={styles.cardName} allowFontScaling>{vital.name}</Text>
        {hasReading ? (
          <Text style={styles.cardValue} allowFontScaling>
            {reading.value} <Text style={styles.cardUnit}>{reading.unit}</Text>
          </Text>
        ) : (
          <Text style={styles.cardNoData} allowFontScaling>No readings yet</Text>
        )}
      </View>

      <View style={styles.cardStatus}>
        {hasReading ? (
          <>
            <View style={[styles.pill, isWaiting ? styles.pillWaiting : styles.pillSynced]}>
              <Text style={[styles.pillText, isWaiting ? styles.pillTextWaiting : styles.pillTextSynced]}>
                {isWaiting ? '↑ Waiting' : '✓ Synced'}
              </Text>
            </View>
            {!!reading.time && <Text style={styles.cardTime}>{reading.time}</Text>}
          </>
        ) : (
          <View style={[styles.pill, styles.pillIdle]}>
            <Text style={[styles.pillText, styles.pillTextIdle]}>—</Text>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e6ea',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
    shadowColor: '#103c63',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardInactive: { backgroundColor: '#f6f7f9' },
  cardIcon: { width: 48, height: 48, marginRight: 14 },
  cardIconInactive: { opacity: 0.4 },
  cardBody: { flex: 1 },
  cardName: { fontSize: 17, fontWeight: '600', color: MUTED, marginBottom: 3 },
  cardNameInactive: { color: '#98a2ac', marginBottom: 0 },
  cardValue: { fontSize: 30, fontWeight: '800', color: INK },
  cardUnit: { fontSize: 16, fontWeight: '600', color: MUTED },
  cardNoData: { fontSize: 18, fontWeight: '600', color: NAV_INACTIVE },
  cardStatus: { alignItems: 'flex-end', marginLeft: 10 },
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 6 },
  pillSynced: { backgroundColor: '#e6f4ea' },
  pillWaiting: { backgroundColor: '#fff3e0' },
  pillIdle: { backgroundColor: '#eef0f2' },
  pillText: { fontSize: 14, fontWeight: '700' },
  pillTextSynced: { color: '#1e7e34' },
  pillTextWaiting: { color: '#e07c00' },
  pillTextIdle: { color: NAV_INACTIVE },
  cardTime: { fontSize: 13, fontWeight: '600', color: MUTED },
});
