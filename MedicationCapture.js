// MedicationCapture.js — photograph a medication label, read it ON-DEVICE, and use the
// text to pre-fill a DRAFT the patient then reviews (medications step 5, entry path A).
//
// Two things this screen makes true and states plainly:
//   1. The result is only a draft — after the photo, the patient lands on the entry form
//      and must check and confirm every field (especially the dose) before submitting.
//      A misread strength is correctable there, before anything is saved. (Same
//      unconfirmed path as typing.)
//   2. The photo is NOT kept. It's read on the phone and discarded immediately — never
//      saved to the camera roll, never uploaded. The screen says so in one sentence.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Image, Alert, StatusBar, ActivityIndicator,
} from 'react-native';
import globalStyles from './globalStyles';
import { captureAndReadLabel } from './labelOcr';

const BRAND = globalStyles.primaryColor.color;
const INK = '#1f2d3d';
const MUTED = '#5b6b7a';

const TIPS = [
  'Find good light and avoid glare on the label.',
  'Fill the frame with the label — get close.',
  'Hold steady until it’s sharp.',
  'Photograph the label, not the cap.',
];

export default function MedicationCapture({ navigation }) {
  const [busy, setBusy] = useState(false);
  const back = () => (navigation?.canGoBack?.() ? navigation.goBack() : navigation.navigate('Profile'));

  const takePhoto = async () => {
    setBusy(true);
    try {
      const res = await captureAndReadLabel();
      if (res?.cancelled) return; // stay on this screen
      // The photo is already discarded. Hand off to the entry form:
      //  - a resolved NDC gives a confident name/strength/form draft (no dose/frequency);
      //  - otherwise the recognized text lines, for the patient to pick the name from.
      if (res.draft) {
        navigation.navigate('MedicationEntry', { draft: res.draft });
      } else {
        navigation.navigate('MedicationEntry', { textLines: res.lines || [] });
      }
    } catch (err) {
      Alert.alert(
        'Couldn’t read the label',
        'You can try the photo again, or type the medication in yourself.',
        [
          { text: 'Type it in', onPress: () => navigation.navigate('MedicationEntry') },
          { text: 'Try again' },
        ]
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={styles.backHit}>
          <Image source={require('./assets/icon_back.png')} style={styles.backIcon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} allowFontScaling>Scan a Label</Text>
        <View style={styles.backHit} />
      </View>

      <View style={styles.body}>
        <View style={styles.illus}>
          <Text style={styles.illusGlyph}>💊📷</Text>
        </View>

        <Text style={styles.lead} allowFontScaling>
          Take a photo of the label on your medication bottle. We’ll read it and fill in a
          draft for you to check.
        </Text>

        {/* Constraint #2 — one honest sentence that the photo isn't kept. */}
        <View style={styles.privacyNote}>
          <Text style={styles.privacyText} allowFontScaling>
            The photo is only used to read the label on your phone. It isn’t saved or sent
            anywhere.
          </Text>
        </View>

        <View style={styles.guide}>
          <Text style={styles.guideTitle} allowFontScaling>For a clear photo</Text>
          {TIPS.map((t, i) => (
            <View key={i} style={styles.tipRow}>
              <Text style={styles.tipDot}>•</Text>
              <Text style={styles.tipText} allowFontScaling>{t}</Text>
            </View>
          ))}
        </View>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          style={[styles.shootBtn, busy && { opacity: 0.6 }]}
          onPress={takePhoto}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Take photo of label"
        >
          {busy ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.shootText} allowFontScaling>Take photo of label</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.typeInstead}
          onPress={() => navigation.navigate('MedicationEntry')}
          accessibilityRole="button"
          accessibilityLabel="Type it in instead"
        >
          <Text style={styles.typeInsteadText} allowFontScaling>Type it in instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f7f9' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#e4eaef',
  },
  backHit: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  backIcon: { width: 26, height: 26, tintColor: INK },
  headerTitle: { fontSize: 20, fontWeight: '800', color: INK },

  body: { flex: 1, padding: 20 },
  illus: { alignItems: 'center', marginTop: 8, marginBottom: 12 },
  illusGlyph: { fontSize: 44 },
  lead: { fontSize: 18, color: INK, lineHeight: 26, textAlign: 'center' },

  privacyNote: {
    marginTop: 16, backgroundColor: '#eef4f8', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#d3e2ec',
  },
  privacyText: { fontSize: 16, color: '#0a4a5e', lineHeight: 23, textAlign: 'center' },

  guide: { marginTop: 20 },
  guideTitle: { fontSize: 17, fontWeight: '800', color: INK, marginBottom: 8 },
  tipRow: { flexDirection: 'row', marginBottom: 8 },
  tipDot: { color: BRAND, fontSize: 18, width: 18 },
  tipText: { color: MUTED, fontSize: 16, flex: 1, lineHeight: 23 },

  shootBtn: {
    backgroundColor: BRAND, borderRadius: 14, paddingVertical: 18, alignItems: 'center',
    minHeight: 58, justifyContent: 'center',
  },
  shootText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  typeInstead: { paddingVertical: 16, alignItems: 'center', marginTop: 6, minHeight: 52, justifyContent: 'center' },
  typeInsteadText: { color: BRAND, fontSize: 18, fontWeight: '700' },
});
