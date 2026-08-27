// PatientHome.js
//
// Patient landing screen: a hero greeting, a reading reminder, and a "Today's
// Readings" list of per-vital cards, with a hand-rolled bottom nav.
//
// The vital catalog and enrollment (which vitals are active vs greyed "Not
// included") live in vitals.js, shared with Readings and the reminder so the three
// can't drift. `enrolled` is bp-only for now — see vitals.js and
// EDUCATION_FOLLOWUPS.md #1. All five vitals are SHOWN; only enrolled ones fetch a
// reading and read as active.
//
// NO NEW DEPENDENCIES: solid header (no LinearGradient), hand-rolled tab bar (no
// @react-navigation/bottom-tabs), PNG assets already in ./assets.

import React, { useCallback, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import globalStyles from './globalStyles';
import { API_BASE as AUTH_BASE } from './apiConfig';
import { VITALS, ENROLLED_VITALS } from './vitals';
import { loadBpReading } from './bpReading';
import { drainOutbox } from './outbox';
import VitalCard from './VitalCard';
import ReadingReminder from './ReadingReminder';

const NAVY = '#103c63';
const BRAND = globalStyles.primaryColor.color;
const MUTED = '#5b6b78';
const NAV_INACTIVE = '#9aa5ac';

export default function PatientHome({ navigation }) {
  const [firstName, setFirstName] = useState('');
  const [readings, setReadings] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadGreeting = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_BASE}/api/auth/check-me`, { method: 'GET', credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok && data.user && data.user.name) {
        setFirstName(data.user.name.split(' ')[0] || '');
      }
    } catch (e) {
      // Non-fatal: a missing name just yields "Hello 👋".
    }
  }, []);

  const loadAll = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    // Deliver anything queued first so a fresh reading flips Waiting -> Synced.
    try { await drainOutbox(); } catch (e) {}

    const results = {};
    for (const vital of VITALS) {
      if (!vital.enrolled) continue;
      if (vital.key === 'bp') results.bp = await loadBpReading();
    }
    setReadings(results);
    setLoading(false);
    if (isRefresh) setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGreeting();
      loadAll(false);
    }, [loadGreeting, loadAll])
  );

  const onRefresh = useCallback(() => loadAll(true), [loadAll]);

  const reminderItems = ENROLLED_VITALS.map((v) => ({ vital: v, reading: readings[v.key] }));

  const NAV_ITEMS = [
    { key: 'home',     label: 'Home',     icon: require('./assets/home.png'),       route: null, active: true },
    { key: 'readings', label: 'Readings', icon: require('./assets/graph.png'),      route: 'Readings' },
    { key: 'messages', label: 'Messages', icon: require('./assets/start_chat.png'), route: 'Connection' },
    { key: 'profile',  label: 'Profile',  icon: require('./assets/user.png'),       route: 'Profile' },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
      >
        {/* Hero header — solid navy band, no photo. */}
        <View style={styles.hero}>
          <Text style={styles.heroGreeting} allowFontScaling>
            Hello{firstName ? ` ${firstName}` : ''} <Text style={styles.wave}>👋</Text>
          </Text>
          <Text style={styles.heroSubtitle} allowFontScaling>
            Your readings sync automatically
          </Text>
        </View>

        {/* Reading reminder — prompt or done state, per enrolled vital. */}
        {!loading && (
          <ReadingReminder
            items={reminderItems}
            onStart={(v) => v.route && navigation.navigate(v.route)}
          />
        )}

        {/* Today's Readings */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>TODAY'S READINGS</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Readings')} accessibilityRole="button">
            <Text style={styles.viewAll}>View all</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        ) : (
          VITALS.map((vital) => (
            <VitalCard
              key={vital.key}
              vital={vital}
              reading={readings[vital.key]}
              onPress={vital.enrolled && vital.route ? () => navigation.navigate(vital.route) : null}
            />
          ))
        )}
      </ScrollView>

      {/* Bottom nav — hand-rolled, no tab-navigator dependency. */}
      <View style={styles.navBar}>
        {NAV_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.navItem}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => { if (item.route) navigation.navigate(item.route); }}
          >
            <Image
              source={item.icon}
              style={[styles.navIcon, { tintColor: item.active ? BRAND : NAV_INACTIVE }]}
              resizeMode="contain"
            />
            <Text style={[styles.navLabel, { color: item.active ? BRAND : NAV_INACTIVE }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  scrollContent: { paddingBottom: 24 },

  hero: {
    backgroundColor: NAVY,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 34,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroGreeting: { color: '#ffffff', fontSize: 32, fontWeight: '800', letterSpacing: 0.2 },
  wave: { fontSize: 30 },
  heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 17, marginTop: 8, fontWeight: '500' },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 22,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: MUTED, letterSpacing: 1.1 },
  viewAll: { fontSize: 16, fontWeight: '700', color: BRAND },

  loadingBox: { paddingVertical: 48, alignItems: 'center' },

  navBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e2e6ea',
    backgroundColor: '#ffffff',
    paddingTop: 8,
    paddingBottom: 6,
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  navIcon: { width: 26, height: 26, marginBottom: 3 },
  navLabel: { fontSize: 12, fontWeight: '700' },
});
