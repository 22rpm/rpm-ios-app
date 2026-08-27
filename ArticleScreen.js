// ArticleScreen.js — renders one owned Help article (title + plain-language
// paragraphs) from helpContent.js. The BP guide's slot is `pending` until its
// content lands, so it shows a friendly placeholder instead of a dead screen.

import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Image, StatusBar } from 'react-native';
import { findHelpArticle } from './helpContent';

const NAVY = '#103c63';
const MUTED = '#5b6b78';

export default function ArticleScreen({ route, navigation }) {
  const id = route && route.params && route.params.id;
  const article = findHelpArticle(id);

  const back = () => (navigation?.canGoBack?.() ? navigation.goBack() : navigation.navigate('Home'));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />
      <View style={styles.header}>
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel="Back">
          <Image source={require('./assets/icon_back.png')} style={styles.backIcon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{article ? article.title : 'Help'}</Text>
        <View style={styles.backIcon} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {!article ? (
          <Text style={styles.paragraph}>This article isn’t available.</Text>
        ) : article.pending || !article.body ? (
          <View style={styles.pendingWrap}>
            <Text style={styles.pendingTitle} allowFontScaling>Coming soon</Text>
            <Text style={styles.paragraph} allowFontScaling>
              We’re putting this guide together. In the meantime, your care team can walk you through it —
              tap Messages to reach them.
            </Text>
          </View>
        ) : (
          article.body.map((p, i) => (
            <Text key={i} style={styles.paragraph} allowFontScaling>{p}</Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backIcon: { width: 24, height: 24, tintColor: '#ffffff' },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  scroll: { padding: 22 },
  paragraph: { fontSize: 18, lineHeight: 27, color: '#22303a', marginBottom: 16 },
  pendingWrap: { paddingTop: 8 },
  pendingTitle: { fontSize: 22, fontWeight: '800', color: NAVY, marginBottom: 10 },
});
