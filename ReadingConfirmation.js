// ReadingConfirmation.js — shown after a reading, reflecting REAL delivery state:
//
//   state='sent'   -> a confirmed successful POST (the reading cleared the outbox).
//                     "Reading sent" + shared-with-care-team.
//   state='queued' -> captured and saved locally but NOT yet delivered (offline /
//                     POST not confirmed). Deliberately does NOT say "sent".
//
// Requires a tap (Done) rather than auto-dismissing — an auto-hiding toast is easy
// for an elderly patient to miss, and this appears once at the natural end of a
// reading (not a random interruption), so one tap isn't grating. No "contact your
// provider" (implies something's wrong on a normal reading) and no "have a great
// day" (grating twice a day). Out-of-range wording is intentionally NOT here — that
// is a clinical decision, pending.

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import globalStyles from './globalStyles';

const BRAND = globalStyles.primaryColor.color;

export default function ReadingConfirmation({ visible, state, systolic, diastolic, onClose }) {
  const sent = state === 'sent';
  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={[styles.badge, sent ? styles.badgeSent : styles.badgeQueued]}>
            <Text style={[styles.badgeGlyph, sent ? styles.glyphSent : styles.glyphQueued]}>
              {sent ? '✓' : '⏱'}
            </Text>
          </View>

          <Text style={styles.title} allowFontScaling>{sent ? 'Reading sent' : 'Reading saved'}</Text>

          <Text style={styles.value} allowFontScaling>
            {systolic}/{diastolic} <Text style={styles.unit}>mmHg</Text>
          </Text>

          <Text style={styles.line} allowFontScaling>
            {sent
              ? 'Shared with your care team.'
              : 'We’ll send it to your care team automatically when you’re back online.'}
          </Text>

          <TouchableOpacity style={styles.button} onPress={onClose} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={styles.buttonText} allowFontScaling>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(16,60,99,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 22, alignItems: 'center', paddingVertical: 30, paddingHorizontal: 24 },
  badge: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  badgeSent: { backgroundColor: '#e6f4ea' },
  badgeQueued: { backgroundColor: '#fff3e0' },
  badgeGlyph: { fontSize: 38, fontWeight: '800' },
  glyphSent: { color: '#1e7e34' },
  glyphQueued: { color: '#e07c00' },
  title: { fontSize: 24, fontWeight: '800', color: '#103c63', marginBottom: 8 },
  value: { fontSize: 38, fontWeight: '800', color: '#103c63' },
  unit: { fontSize: 18, fontWeight: '700', color: '#5b6b78' },
  line: { fontSize: 17, color: '#3f5361', textAlign: 'center', lineHeight: 24, marginTop: 12, marginBottom: 24 },
  button: { alignSelf: 'stretch', backgroundColor: BRAND, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});
