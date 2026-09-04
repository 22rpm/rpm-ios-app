// Education.js — the Education tab: a Help section (our owned content, most useful,
// shown first) and a Learn section (MedlinePlus articles pulled live for the
// patient's condition — hypertension for now). MedlinePlus links open in an in-app
// browser (SFSafariViewController) so the patient stays in the app.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
} from 'react-native';
import globalStyles from './globalStyles';
import { fetchEducationArticles } from './medlineplus';
import { openInAppBrowser } from './inAppBrowser';
import { HELP_ARTICLES } from './helpContent';

const NAVY = '#103c63';
const BRAND = globalStyles.primaryColor.color;
const MUTED = '#5b6b78';

function Row({ title, subtitle, trailing, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} allowFontScaling>{title}</Text>
        {!!subtitle && <Text style={styles.cardSub} numberOfLines={2} allowFontScaling>{subtitle}</Text>}
      </View>
      <Text style={styles.trailing}>{trailing || '›'}</Text>
    </TouchableOpacity>
  );
}

export default function Education({ navigation }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const list = await fetchEducationArticles(); // hypertension (I10) — see medlineplus.js
    setArticles(list);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation?.canGoBack?.() ? navigation.goBack() : navigation.navigate('PatientHome'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Image source={require('./assets/icon_back.png')} style={styles.backIcon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Learn &amp; Help</Text>
        <View style={styles.backIcon} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={BRAND} />}
      >
        {/* Help first — our own content */}
        <Text style={styles.sectionTitle}>HELP</Text>
        {HELP_ARTICLES.map((a) => (
          <Row
            key={a.id}
            title={a.title}
            subtitle={a.subtitle}
            trailing={a.pending ? 'Soon' : '›'}
            onPress={() =>
              a.url ? openInAppBrowser(a.url) : navigation.navigate('Article', { id: a.id })
            }
          />
        ))}

        {/* Learn — MedlinePlus, opens in the in-app browser */}
        <Text style={[styles.sectionTitle, styles.sectionSpacer]}>LEARN ABOUT YOUR HEALTH</Text>
        {loading ? (
          <ActivityIndicator size="large" color={BRAND} style={styles.loader} />
        ) : articles.length === 0 ? (
          <Text style={styles.empty} allowFontScaling>
            Couldn’t load articles right now. Check your connection and pull down to refresh.
          </Text>
        ) : (
          articles.map((a) => (
            <Row key={a.id} title={a.title} subtitle={a.summary} onPress={() => openInAppBrowser(a.url)} />
          ))
        )}

        <Text style={styles.source} allowFontScaling>
          Health information from MedlinePlus, U.S. National Library of Medicine.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backIcon: { width: 24, height: 24, tintColor: '#ffffff' },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  scroll: { paddingBottom: 28 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: MUTED, letterSpacing: 1.1, marginHorizontal: 20, marginTop: 18, marginBottom: 10 },
  sectionSpacer: { marginTop: 26 },
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
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#103c63' },
  cardSub: { fontSize: 15, fontWeight: '500', color: MUTED, marginTop: 4, lineHeight: 20 },
  trailing: { fontSize: 20, fontWeight: '700', color: BRAND, marginLeft: 12 },
  loader: { marginTop: 24 },
  empty: { marginHorizontal: 20, marginTop: 8, fontSize: 16, color: MUTED, lineHeight: 22 },
  source: { marginHorizontal: 20, marginTop: 20, fontSize: 12, color: '#9aa5ac', lineHeight: 17 },
});
