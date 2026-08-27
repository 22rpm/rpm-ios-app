// inAppBrowser.js — open a URL in an in-app browser (iOS SFSafariViewController),
// so an elderly patient stays inside the app instead of getting kicked out to
// Safari (once out, they usually don't come back).
//
// Uses the native RPMBrowser module (ios/VTMDeviceManager/RPMBrowser.m). If that
// module isn't compiled in yet, it falls back to Linking.openURL (external Safari)
// so the feature still works — the Education tab is never dead. Only http(s).

import { NativeModules, Linking } from 'react-native';

const { RPMBrowser } = NativeModules;

export const HAS_IN_APP_BROWSER = !!(RPMBrowser && RPMBrowser.open);

export function openInAppBrowser(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  if (HAS_IN_APP_BROWSER) {
    RPMBrowser.open(url);
    return;
  }
  // Fallback until the native SFSafariViewController module is in the build.
  Linking.openURL(url).catch(() => {});
}
