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

import React, { useState, useRef, useCallback, useEffect } from 'react';
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

// Closed lists patients tap instead of typing (free text still available below each).
const FORM_OPTIONS = ['Tablet', 'Capsule', 'Liquid', 'Inhaler', 'Injection', 'Patch', 'Drops', 'Cream'];
const FREQ_OPTIONS = [
  'Once a day', 'Twice a day', '3 times a day', '4 times a day',
  'Every morning', 'At bedtime', 'As needed', 'Every other day', 'Weekly',
];

// Pull the dose form (e.g., "Oral Tablet") from an RxNorm name — the text after the
// strength, minus any [Brand] bracket. NOTE: strength is intentionally NOT extracted
// into the dose field — the manufactured strength is not the patient's dose.
function extractForm(name) {
  const cleaned = (name || '').replace(/\[[^\]]*\]/g, '').trim();
  const m = cleaned.match(/(?:\d+(?:\.\d+)?)\s?(?:mg|mcg|g|ml|%|units?|iu)\b\s*(.*)$/i);
  return m && m[1] ? m[1].trim() : '';
}
// Snap an extracted form phrase ("Oral Capsule") to a chip ("Capsule") when possible,
// so the picker highlights it; otherwise keep the raw text (shown in the free-text box).
function normalizeForm(text) {
  if (!text) return '';
  const hit = FORM_OPTIONS.find((o) => text.toLowerCase().includes(o.toLowerCase()));
  return hit || text;
}

export default function MedicationEntryScreen({ navigation, route }) {
  const editing = route?.params?.medication || null;
  const draft = route?.params?.draft || null;
  const src = editing || draft || {};

  const [name, setName] = useState(src.drug_name || '');
  const [rxcui, setRxcui] = useState(src.rxcui || null);
  const [dose, setDose] = useState(src.dose || '');
  const [form, setForm] = useState(normalizeForm(src.route || ''));
  const [frequency, setFrequency] = useState(src.frequency || '');
  const [instructions, setInstructions] = useState(src.admin_instructions || '');
  const [pharmacyName, setPharmacyName] = useState(src.pharmacy_name || '');
  const [pharmacyPhone, setPharmacyPhone] = useState(src.pharmacy_phone || '');
  // True when this entry was pre-filled from a label photo — drives the "check the
  // draft" banner and marks source='photo' on submit (provenance; stays set through
  // the patient's corrections, since they're correcting a photo-originated draft).
  const [fromPhoto, setFromPhoto] = useState(!!draft);
  // Recognized text lines to PICK a name from when no NDC was found (no guessing).
  const [lines, setLines] = useState(route?.params?.textLines || []);

  // A returning photo scan updates this already-mounted screen's params. An NDC draft
  // fills name / rxcui / form ONLY — dose and frequency stay for the patient (the
  // manufactured strength is not the patient's dose).
  useEffect(() => {
    const d = route?.params?.draft;
    if (!d) return;
    if (d.drug_name != null) setName(d.drug_name);
    setRxcui(d.rxcui || null);
    if (d.route) setForm(normalizeForm(d.route));
    setFromPhoto(true);
    setLines([]);
  }, [route?.params?.draft]);

  useEffect(() => {
    const tl = route?.params?.textLines;
    if (tl) setLines(tl);
  }, [route?.params?.textLines]);

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
    // Pre-fill FORM from the concept name; never the dose (strength != dose).
    const f = extractForm(item.name);
    if (f) setForm(normalizeForm(f));
    setShowResults(false);
    setResults([]);
  };

  // Patient taps the recognized line that is the drug name (photo, no-NDC path).
  const pickLine = (line) => {
    setLines([]);
    onChangeName(line); // sets the name and triggers a search so a match can attach
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
      source: fromPhoto ? 'photo' : 'typed',
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

          {/* Photo draft: the medication came from the bottle, but the patient still
              sets — and must review — how much they take and how often. */}
          {fromPhoto && (
            <View style={styles.photoBanner}>
              <Text style={styles.photoBannerTitle} allowFontScaling>Filled in from your bottle</Text>
              <Text style={styles.photoBannerBody} allowFontScaling>
                We read the medication from your bottle. Now set how much you take and how
                often — we left those blank on purpose, because only you know what you were
                told to take. Check the name too.
              </Text>
            </View>
          )}

          {!editing && (
            <TouchableOpacity
              style={styles.scanBtn}
              onPress={() => navigation.navigate('MedicationCapture')}
              accessibilityRole="button"
              accessibilityLabel="Scan the label with your camera"
            >
              <Text style={styles.scanBtnText} allowFontScaling>
                {fromPhoto ? '📷  Scan the label again' : '📷  Scan the label instead'}
              </Text>
            </TouchableOpacity>
          )}

          {/* No barcode/NDC: show the recognized lines and let the patient pick the name.
              We never guess it. */}
          {lines.length > 0 && !name.trim() && (
            <View style={styles.linePick}>
              <Text style={styles.linePickTitle} allowFontScaling>
                Which line is the medication name?
              </Text>
              {lines.slice(0, 12).map((ln, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.lineItem}
                  onPress={() => pickLine(ln)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${ln}`}
                >
                  <Text style={styles.lineItemText} allowFontScaling>{ln}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.linePickHint} allowFontScaling>
                None of these? Type the name below instead.
              </Text>
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

          <Field
            label="How much you take each time"
            value={dose}
            onChange={setDose}
            placeholder="For example: 1 tablet, or half a tablet"
          />
          <PickerField label="Form" value={form} onChange={setForm} options={FORM_OPTIONS} placeholder="Other — type the form" />
          <PickerField label="How often" value={frequency} onChange={setFrequency} options={FREQ_OPTIONS} placeholder="Other — type how often" />
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

// A closed list the patient TAPS, with a free-text box as a fallback. The value is one
// string: tapping a chip fills it, and they can always type instead.
function PickerField({ label, value, onChange, options, placeholder }) {
  return (
    <>
      <Text style={styles.label} allowFontScaling>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onChange(selected ? '' : opt)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={opt}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]} allowFontScaling>
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        style={[styles.input, styles.chipInput]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        allowFontScaling
        accessibilityLabel={`${label} — or type your own`}
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

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 999, backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center',
  },
  chipSelected: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 16, fontWeight: '600', color: INK },
  chipTextSelected: { color: '#fff' },
  chipInput: { marginTop: 2 },

  linePick: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: BRAND, borderRadius: 12,
    padding: 14, marginBottom: 6,
  },
  linePickTitle: { fontSize: 17, fontWeight: '800', color: INK, marginBottom: 8 },
  lineItem: {
    borderTopWidth: 1, borderTopColor: '#eef2f5', paddingVertical: 14, minHeight: 50,
    justifyContent: 'center',
  },
  lineItemText: { fontSize: 17, color: INK },
  linePickHint: { fontSize: 14, color: MUTED, marginTop: 8 },
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

  photoBanner: {
    backgroundColor: '#eef4f8', borderWidth: 1, borderColor: '#d3e2ec', borderRadius: 12,
    padding: 16, marginBottom: 10,
  },
  photoBannerTitle: { fontSize: 17, fontWeight: '800', color: '#0a4a5e', marginBottom: 4 },
  photoBannerBody: { fontSize: 16, color: '#0a4a5e', lineHeight: 23 },

  scanBtn: {
    borderWidth: 1.5, borderColor: BRAND, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', minHeight: 52, justifyContent: 'center', marginBottom: 4,
  },
  scanBtnText: { color: BRAND, fontSize: 17, fontWeight: '800' },

  reassure: { fontSize: 16, color: MUTED, marginTop: 22, marginBottom: 8, lineHeight: 23 },

  saveBtn: {
    backgroundColor: BRAND, borderRadius: 14, paddingVertical: 18, alignItems: 'center',
    marginTop: 10, minHeight: 58, justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  cancelBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 6, minHeight: 52, justifyContent: 'center' },
  cancelBtnText: { color: BRAND, fontSize: 18, fontWeight: '700' },
});
