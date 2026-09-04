// Readings.js — the Readings tab. Same card layout as Home (shared VitalCard), as a
// standalone screen: a title bar + the per-vital cards. Tapping an enrolled card
// opens that vital's detail/history screen.

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
import { VITALS } from './vitals';
import { loadBpReading } from './bpReading';
import { drainOutbox } from './outbox';
import VitalCard from './VitalCard';

const NAVY = '#103c63';
const BRAND = globalStyles.primaryColor.color;

export default function Readings({ navigation }) {
  const [readings, setReadings] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
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

  useFocusEffect(useCallback(() => { load(false); }, [load]));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => (navigation?.canGoBack?.() ? navigation.goBack() : navigation.navigate('PatientHome'))} accessibilityRole="button" accessibilityLabel="Back">
          <Image source={require('./assets/icon_back.png')} style={styles.backIcon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Readings</Text>
        <View style={styles.backIcon} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={BRAND} />}
        >
          {VITALS.map((vital) => (
            <VitalCard
              key={vital.key}
              vital={vital}
              reading={readings[vital.key]}
              onPress={vital.enrolled && vital.route ? () => navigation.navigate(vital.route) : null}
            />
          ))}
        </ScrollView>
      )}
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
  scrollContent: { paddingTop: 16, paddingBottom: 24 },
  loadingBox: { paddingVertical: 48, alignItems: 'center' },
});
