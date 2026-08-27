// ReadingReminder.js — the "time for your reading" banner at the top of Home.
//
// Keys off ENROLLED vitals (bp today; multi-vital ready). For each enrolled vital
// it's either:
//   - DONE (a reading taken today, Synced OR still Waiting) -> warm green confirmation
//   - DUE  -> a gentle prompt that softens in the evening, never alarms. No red:
//            an anxious elderly patient acts less, not more.
//
// A DUE single-vital banner is tappable and calls onStart(vital) to jump straight
// into taking the reading.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import globalStyles from './globalStyles';
import { clockTime } from './vitals';

const BRAND = globalStyles.primaryColor.color;

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function Banner({ tone, title, subtitle, onPress }) {
  const done = tone === 'done';
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      style={[styles.banner, done ? styles.bannerDone : styles.bannerTodo]}
      onPress={onPress || undefined}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text style={[styles.mark, done ? styles.markDone : styles.markTodo]}>
        {done ? '✓' : '⏰'}
      </Text>
      <View style={styles.body}>
        <Text style={[styles.title, done ? styles.titleDone : styles.titleTodo]} allowFontScaling>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.subtitle} allowFontScaling>{subtitle}</Text>
        )}
      </View>
    </Wrap>
  );
}

export default function ReadingReminder({ items, onStart }) {
  if (!items || items.length === 0) return null;

  const due = items.filter((i) => !(i.reading && i.reading.takenToday));
  const evening = new Date().getHours() >= 18;

  // Everything enrolled has been taken today.
  if (due.length === 0) {
    if (items.length === 1) {
      const only = items[0];
      const at = only.reading ? clockTime(only.reading.at) : '';
      return (
        <Banner
          tone="done"
          title={`${cap(only.vital.reminderNoun)} done for today`}
          subtitle={at ? `Recorded at ${at}` : 'Recorded today'}
        />
      );
    }
    return <Banner tone="done" title="You're all caught up for today" subtitle="All your readings are in." />;
  }

  // One reading due — gentle prompt, tappable to start.
  if (due.length === 1) {
    const vital = due[0].vital;
    const noun = vital.reminderNoun;
    return (
      <Banner
        tone="todo"
        title={evening
          ? `There's still time to take your ${noun} today`
          : `Time for your ${noun} reading today`}
        subtitle={`Tap here to start.`}
        onPress={onStart ? () => onStart(vital) : undefined}
      />
    );
  }

  // Several due.
  return (
    <Banner
      tone="todo"
      title={`You have ${due.length} readings to take today`}
      subtitle={evening ? 'There’s still time.' : 'Tap a card below when you’re ready.'}
    />
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  bannerTodo: { backgroundColor: '#e9f2f8', borderColor: '#cfe1ee' },
  bannerDone: { backgroundColor: '#e6f4ea', borderColor: '#c7e6d0' },
  mark: { fontSize: 26, marginRight: 12 },
  markTodo: { color: BRAND },
  markDone: { color: '#1e7e34' },
  body: { flex: 1 },
  title: { fontSize: 18, fontWeight: '800' },
  titleTodo: { color: '#0f3f5f' },
  titleDone: { color: '#1e5b2e' },
  subtitle: { fontSize: 14, fontWeight: '600', color: '#5b6b78', marginTop: 3 },
});
