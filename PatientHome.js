// PatientHome.js
//
// Patient landing screen: a hero greeting + a "Today's Readings" list of
// per-vital cards (icon, name, value+unit, real sync pill + relative time),
// with a hand-rolled bottom nav.
//
// WHY ONLY BLOOD PRESSURE RENDERS
// -------------------------------
// The card list is written to render an array of ENROLLED vitals, but that array
// currently holds ONLY `bp`. Per CARE_ACTIVITY_NOTES: `bp` is the sole device
// type verified against real `dev_data` traffic and seeded `is_active = 1`;
// glucose/spo2/weight/temperature are seeded `is_active = 0` with an unknown
// vendor `dev_type`, so a reading for them can't be parsed or trusted yet. The
// per-patient enrollment source of truth (`rpm_device_setups`) also isn't on prod
// yet (it lives on `feature/care-activity`). Rendering the other four would mean
// showing permanent "Waiting…" cards for devices a patient doesn't have — exactly
// what we were told not to do. When a non-BP vital gets a verified vendor string
// and enrollment ships, add it to ENROLLED_VITALS (and source that array from the
// patient's real enrollment) — the rest of this screen already handles N cards.
//
// NO NEW DEPENDENCIES: solid header (no LinearGradient), hand-rolled tab bar (no
// @react-navigation/bottom-tabs), PNG assets already in ./assets, Unicode glyphs
// for the pill marks — all matching existing app conventions.

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
import axios from 'axios';
import ViatomDeviceManager from './ViatomDeviceManager';
import { drainOutbox } from './outbox';
import globalStyles from './globalStyles';
import { API_BASE as AUTH_BASE, DEV_DATA_BASE } from './apiConfig';

// Hosts come from apiConfig (single source of truth): AUTH_BASE for check-me,
// DEV_DATA_BASE for the latest-reading GET.

// Palette (screens define local colors; brand primary comes from globalStyles).
const NAVY = '#103c63';
const BRAND = globalStyles.primaryColor.color; // #014e6b
const INK = '#103c63';
const MUTED = '#5b6b78';
const CARD_BG = '#ffffff';
const CARD_BORDER = '#e2e6ea';
const NAV_INACTIVE = '#9aa5ac';

// The only vital we can honestly render today (see header comment).
const ENROLLED_VITALS = [
  {
    key: 'bp',
    name: 'Blood Pressure',
    unit: 'mmHg',
    icon: require('./assets/BP.png'),
    deviceType: 'bp',
  },
];

// Relative timestamp for elderly-friendly, glanceable freshness.
function relativeTime(input) {
  const t = typeof input === 'number' ? input : Date.parse(input);
  if (!t || isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'Just now';
  if (diff < 60 * 1000) return 'Just now';
  const mins = Math.floor(diff / (60 * 1000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(diff / (60 * 60 * 1000));
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}

export default function PatientHome({ navigation }) {
  const [firstName, setFirstName] = useState('');
  // Per-vital state keyed by vital.key: { value, unit, status, time } | null.
  const [readings, setReadings] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadGreeting = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_BASE}/api/auth/check-me`, {
        method: 'GET',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.ok && data.user && data.user.name) {
        // No dedicated firstName field — split like Profile.js does.
        setFirstName(data.user.name.split(' ')[0] || '');
      }
    } catch (e) {
      // Non-fatal: a missing name just yields "Hello 👋".
    }
  }, []);

  // Resolve the freshest BP reading AND its real sync state. A reading still in
  // the durable outbox (getPendingResults) has not been confirmed by the server,
  // so it is the newest truth and its pill is "Waiting". Otherwise the server's
  // latest is the newest and it is "Synced". drainOutbox() deletes a row only on
  // a confirmed 2xx+success, so "present in the queue" is an exact proxy for
  // "not yet synced."
  const loadBP = useCallback(async () => {
    let pending = [];
    try {
      pending = (await ViatomDeviceManager.getPendingResults()) || [];
    } catch (e) {
      pending = [];
    }

    // Newest queued (undelivered) BP reading, if any.
    const queued = pending
      .filter((r) => r && r.systolic != null && r.diastolic != null)
      .sort((a, b) => (b.enqueuedAt || 0) - (a.enqueuedAt || 0))[0];

    if (queued) {
      return {
        value: `${queued.systolic}/${queued.diastolic}`,
        unit: 'mmHg',
        status: 'waiting',
        time: relativeTime(queued.enqueuedAt || queued.timestamp),
      };
    }

    // No queued reading — show the server's latest as Synced.
    try {
      const res = await axios.get(
        `${DEV_DATA_BASE}/devices/data/latest?deviceType=bp`,
        { withCredentials: true }
      );
      if (res.data && res.data.success && res.data.data) {
        const v = res.data.data.data || {};
        if (v.systolic != null && v.diastolic != null) {
          return {
            value: `${v.systolic}/${v.diastolic}`,
            unit: 'mmHg',
            status: 'synced',
            time: relativeTime(res.data.data.createdAt),
          };
        }
      }
    } catch (e) {
      // Fall through to the no-data state below.
    }
    return null; // no reading yet
  }, []);

  const loadAll = useCallback(
    async (isRefresh) => {
      if (isRefresh) setRefreshing(true);
      // Try to deliver anything queued first, so a fresh reading flips from
      // Waiting to Synced without the patient doing anything.
      try {
        await drainOutbox();
      } catch (e) {}

      const results = {};
      // Only BP today; loop keeps the shape ready for more vitals.
      for (const vital of ENROLLED_VITALS) {
        if (vital.key === 'bp') {
          results.bp = await loadBP();
        }
      }
      setReadings(results);
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    },
    [loadBP]
  );

  useFocusEffect(
    useCallback(() => {
      loadGreeting();
      loadAll(false);
    }, [loadGreeting, loadAll])
  );

  const onRefresh = useCallback(() => loadAll(true), [loadAll]);

  const NAV_ITEMS = [
    { key: 'home', label: 'Home', icon: require('./assets/home.png'), route: null, active: true },
    { key: 'readings', label: 'Readings', icon: require('./assets/graph.png'), route: 'BloodPressure' },
    { key: 'messages', label: 'Messages', icon: require('./assets/start_chat.png'), route: 'Connection' },
    { key: 'profile', label: 'Profile', icon: require('./assets/user.png'), route: 'Profile' },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />
        }
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

        {/* Today's Readings */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>TODAY'S READINGS</Text>
          <TouchableOpacity onPress={() => navigation.navigate('BloodPressure')} accessibilityRole="button">
            <Text style={styles.viewAll}>View all</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        ) : (
          ENROLLED_VITALS.map((vital) => (
            <VitalCard
              key={vital.key}
              vital={vital}
              reading={readings[vital.key]}
              onPress={() => vital.key === 'bp' && navigation.navigate('BloodPressure')}
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
            onPress={() => {
              if (item.route) navigation.navigate(item.route);
            }}
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

function VitalCard({ vital, reading, onPress }) {
  const hasReading = !!reading;
  const isWaiting = hasReading && reading.status === 'waiting';

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.card}>
      <View style={styles.cardIconWrap}>
        <Image source={vital.icon} style={styles.cardIcon} resizeMode="contain" />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName} allowFontScaling>
          {vital.name}
        </Text>
        {hasReading ? (
          <Text style={styles.cardValue} allowFontScaling>
            {reading.value} <Text style={styles.cardUnit}>{reading.unit}</Text>
          </Text>
        ) : (
          <Text style={styles.cardNoData} allowFontScaling>
            No readings yet
          </Text>
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
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  scrollContent: { paddingBottom: 24 },

  // Hero
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

  // Section
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

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
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
  cardIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#eef4f8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardIcon: { width: 30, height: 30, tintColor: BRAND },
  cardBody: { flex: 1 },
  cardName: { fontSize: 17, fontWeight: '600', color: MUTED, marginBottom: 3 },
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

  // Bottom nav
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
