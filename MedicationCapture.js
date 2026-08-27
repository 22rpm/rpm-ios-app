// MedicationCapture.js — SHELL of the "add medication by photo" flow. A mock camera
// viewfinder with guidance on photographing a pill-bottle label, and a shutter that
// (in this shell) just confirms and returns. No real camera, no OCR, no persistence.
//
// The confirmation deliberately says a team member will REVIEW the label — the real
// version cannot trust OCR to write a drug name/dose into a clinical record without
// human verification. See MEDICATIONS_FOLLOWUPS.md #1.

import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Image, Alert, StatusBar } from 'react-native';
import globalStyles from './globalStyles';

const BRAND = globalStyles.primaryColor.color;

const TIPS = [
  'Find good light and avoid glare on the label.',
  'Fill the frame with the label — get close.',
  'Hold steady until it’s sharp.',
  'Photograph the label, not the cap.',
];

export default function MedicationCapture({ navigation }) {
  const back = () => (navigation?.canGoBack?.() ? navigation.goBack() : navigation.navigate('Profile'));

  const capture = () => {
    Alert.alert(
      'Photo taken',
      'A member of your care team will read the label and add the medication to your list, so your record stays accurate. (This is a preview — nothing was saved.)',
      [{ text: 'OK', onPress: back }]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={styles.header}>
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel="Back">
          <Image source={require('./assets/icon_back.png')} style={styles.backIcon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add a Medication</Text>
        <View style={styles.backIcon} />
      </View>

      {/* Mock viewfinder */}
      <View style={styles.viewfinder}>
        <View style={styles.frame}>
          <Text style={styles.frameGlyph}>📷</Text>
          <Text style={styles.frameText} allowFontScaling>Position the pill bottle label inside the frame</Text>
        </View>
      </View>

      {/* Guidance */}
      <View style={styles.guide}>
        <Text style={styles.guideTitle} allowFontScaling>For a clear photo</Text>
        {TIPS.map((t, i) => (
          <View key={i} style={styles.tipRow}>
            <Text style={styles.tipDot}>•</Text>
            <Text style={styles.tipText} allowFontScaling>{t}</Text>
          </View>
        ))}
      </View>

      {/* Shutter */}
      <View style={styles.shutterBar}>
        <TouchableOpacity style={styles.shutter} onPress={capture} accessibilityRole="button" accessibilityLabel="Take photo">
          <View style={styles.shutterInner} />
        </TouchableOpacity>
        <Text style={styles.shutterLabel} allowFontScaling>Tap to take the photo</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#000',
  },
  backIcon: { width: 24, height: 24, tintColor: '#fff' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },

  viewfinder: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', margin: 16, borderRadius: 16 },
  frame: {
    width: '82%',
    aspectRatio: 1.6,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 14,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  frameGlyph: { fontSize: 40, marginBottom: 10 },
  frameText: { color: '#e9eef2', fontSize: 16, textAlign: 'center', lineHeight: 22 },

  guide: { backgroundColor: '#000', paddingHorizontal: 20, paddingTop: 6 },
  guideTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 8 },
  tipRow: { flexDirection: 'row', marginBottom: 6 },
  tipDot: { color: BRAND, fontSize: 18, width: 16 },
  tipText: { color: '#d7dde2', fontSize: 16, flex: 1, lineHeight: 22 },

  shutterBar: { alignItems: 'center', paddingVertical: 18, backgroundColor: '#000' },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  shutterLabel: { color: '#aeb6bd', fontSize: 14, marginTop: 10 },
});
