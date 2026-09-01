// MedicationEntryScreen.js — patient adds or corrects a medication by TYPING
// (medications step 3, entry path B). Photo capture (path A) is a separate, later step.
//
// Elderly-facing surface: large type, high contrast, big tap targets. Autocomplete is
// a convenience, never a gate — if nothing matches, the typed name is submitted as
// free text (rxcui null) and still goes through the same care-team review.
//
// Used for BOTH add and correct-and-resubmit: route.params.medication pre-fills the
// form; saving an edit returns the entry to review server-side. That is how a patient
// acts on a rejected medication.

import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert, SafeAreaView, StatusBar, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import globalStyles from './globalStyles';
import { createMedication, updateMedication, searchDrugs } from './medicationsApi';

const BRAND = globalStyles.primaryColor.color; // #014e6b
const INK = '#1f2d3d';
const MUTED = '#5b6b7a';
const BORDER = '#c7d0d8';

// Pull a strength like "10 mg" out of an RxNorm name for a convenience pre-fill.
function extractDose(name) {
  const m = (name || '').match(/(\d+(?:\.\d+)?)\s?(mg|mcg|g|ml|%|units?|iu)\b/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : '';
}
// Pull the dose form (e.g., "Oral Tablet") — the text after the strength, minus any
// [Brand] bracket.
function extractForm(name) {
  const cleaned = (name || '').replace(/\[[^\]]*\]/g, '').trim();
  const m = cleaned.match(/(?:\d+(?:\.\d+)?)\s?(?:mg|mcg|g|ml|%|units?|iu)\b\s*(.*)$/i);
  return m && m[1] ? m[1].trim() : '';
}

export default function MedicationEntryScreen({ navigation, route }) {
  const editing = route?.params?.medication || null;

  const [name, setName] = useState(editing?.drug_name || '');
  const [rxcui, setRxcui] = useState(editing?.rxcui || null);
  const [dose, setDose] = useState(editing?.dose || '');
  const [form, setForm] = useState(editing?.route || '');
  const [frequency, setFrequency] = useState(editing?.frequency || '');
  const [instructions, setInstructions] = useState(editing?.admin_instructions || '');
  const [pharmacyName, setPharmacyName] = useState(editing?.pharmacy_name || '');
  const [pharmacyPhone, setPharmacyPhone] = useState(editing?.pharmacy_phone || '');

  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);

  const onChangeName = useCallback((text) => {
    setName(text);
    setRxcui(null); // typing again means the previous match no longer applies
    setShowResults(true);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const { results: r } = await searchDrugs(text.trim());
      setResults(r);
      setSearching(false);
    }, 350);
  }, []);

  const pickResult = (item) => {
    setName(item.name);
    setRxcui(item.rxcui || null);
    const d = extractDose(item.name);
    const f = extractForm(item.name);
    if (d) setDose(d);
    if (f) setForm(f);
    setShowResults(false);
    setResults([]);
  };

  const back = () => (navigation?.canGoBack?.() ? navigation.goBack() : navigation.navigate('Profile'));

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert('Medication name needed', 'Please enter the name of your medication.');
      return;
    }
    setSaving(true);
    const body = {
      drug_name: name.trim(),
      rxcui: rxcui || null,
      dose: dose.trim() || null,
      route: form.trim() || null,
      frequency: frequency.trim() || null,
      admin_instructions: instructions.trim() || null,
      pharmacy_name: pharmacyName.trim() || null,
      pharmacy_phone: pharmacyPhone.trim() || null,
      source: 'typed',
    };
    const res = editing
      ? await updateMedication(editing.id, body)
      : await createMedication(body);
    setSaving(false);
    if (res.ok && res.data?.ok) {
      Alert.alert(
        editing ? 'Medication updated' : 'Medication added',
        'A member of your care team will check it and confirm it on your list.',
        [{ text: 'OK', onPress: back }]
      );
    } else {
      Alert.alert('Could not save', res.data?.message || 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={styles.backHit}>
          <Image source={require('./assets/icon_back.png')} style={styles.backIcon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} allowFontScaling>{editing ? 'Update Medication' : 'Add a Medication'}</Text>
        <View style={styles.backHit} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {editing && editing.status === 'rejected' && !!editing.reject_reason && (
            <View style={styles.rejectHelp}>
              <Text style={styles.rejectHelpTitle} allowFontScaling>Please check this and update it</Text>
              <Text style={styles.rejectHelpBody} allowFontScaling>{editing.reject_reason}</Text>
            </View>
          )}

          <Text style={styles.label} allowFontScaling>Medication name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={onChangeName}
            placeholder="Start typing, e.g. Lisinopril"
            placeholderTextColor={MUTED}
            allowFontScaling
            autoCorrect={false}
            accessibilityLabel="Medication name"
          />
          {showResults && (searching || results.length > 0) && (
            <View style={styles.dropdown}>
              {searching && (
                <View style={styles.dropRow}>
                  <ActivityIndicator color={BRAND} />
                  <Text style={styles.dropSearching} allowFontScaling>Searching…</Text>
                </View>
              )}
              {results.slice(0, 8).map((item, i) => (
                <TouchableOpacity
                  key={`${item.rxcui || 'x'}-${i}`}
                  style={styles.dropItem}
                  onPress={() => pickResult(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${item.name}`}
                >
                  <Text style={styles.dropItemText} allowFontScaling>{item.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={styles.hint} allowFontScaling>
            Pick your medication from the list if you see it. If it isn't there, just type the name — that's fine.
          </Text>

          <Field label="Dose (for example, 10 mg)" value={dose} onChange={setDose} placeholder="10 mg" />
          <Field label="Form (for example, tablet)" value={form} onChange={setForm} placeholder="Tablet by mouth" />
          <Field label="How often (for example, once a day)" value={frequency} onChange={setFrequency} placeholder="Once a day" />
          <Field label="Special instructions (optional)" value={instructions} onChange={setInstructions} placeholder="With food" multiline />
          <Field label="Pharmacy name (optional)" value={pharmacyName} onChange={setPharmacyName} placeholder="Your pharmacy" />
          <Field label="Pharmacy phone (optional)" value={pharmacyPhone} onChange={setPharmacyPhone} placeholder="(555) 555-5555" keyboardType="phone-pad" />

          <Text style={styles.reassure} allowFontScaling>
            A member of your care team will check what you enter and confirm it on your list.
          </Text>

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={onSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save changes' : 'Add medication'}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.saveBtnText} allowFontScaling>{editing ? 'Save changes' : 'Add medication'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={back} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.cancelBtnText} allowFontScaling>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, multiline, keyboardType }) {
  return (
    <>
      <Text style={styles.label} allowFontScaling>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        allowFontScaling
        multiline={!!multiline}
        keyboardType={keyboardType || 'default'}
        accessibilityLabel={label}
      />
    </>
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

  body: { padding: 18, paddingBottom: 48 },

  label: { fontSize: 17, fontWeight: '700', color: INK, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 18, color: INK, minHeight: 52,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  hint: { fontSize: 15, color: MUTED, marginTop: 8, lineHeight: 21 },

  dropdown: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: BRAND, borderRadius: 12,
    marginTop: 6, overflow: 'hidden',
  },
  dropRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  dropSearching: { fontSize: 16, color: MUTED },
  dropItem: { paddingHorizontal: 14, paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#eef2f5', minHeight: 52 },
  dropItemText: { fontSize: 17, color: INK },

  rejectHelp: {
    backgroundColor: '#fff4e5', borderWidth: 1.5, borderColor: '#f0b660', borderRadius: 12,
    padding: 16, marginBottom: 6,
  },
  rejectHelpTitle: { fontSize: 18, fontWeight: '800', color: '#8a5300', marginBottom: 6 },
  rejectHelpBody: { fontSize: 17, color: '#5b4322', lineHeight: 24 },

  reassure: { fontSize: 16, color: MUTED, marginTop: 22, marginBottom: 8, lineHeight: 23 },

  saveBtn: {
    backgroundColor: BRAND, borderRadius: 14, paddingVertical: 18, alignItems: 'center',
    marginTop: 10, minHeight: 58, justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  cancelBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 6, minHeight: 52, justifyContent: 'center' },
  cancelBtnText: { color: BRAND, fontSize: 18, fontWeight: '700' },
});
