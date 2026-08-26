// biometricCredentials.js
//
// Secure storage for the Face ID login credential. Replaces the previous
// AsyncStorage keys `biometric_email` / `biometric_password`, which stored the
// account password in PLAINTEXT (AsyncStorage is unencrypted on iOS — see
// SECURITY_FOLLOWUPS.md #1). The credential now lives in the iOS Keychain
// (encrypted, Secure Enclave-protected), and any pre-existing plaintext copy is
// migrated on first read and then deleted.
//
// TWO SAFETY PROPERTIES (both required by the release owner):
//
//   1. FAIL SAFE, NEVER STRAND A PATIENT. Every read swallows its own errors and
//      returns null instead of throwing. A Keychain failure therefore surfaces to
//      the caller as "no stored credential" -> the UI shows the password field.
//      Biometric login degrades to manual login; it never hangs or silently dies.
//
//   2. CLEAN MIGRATION FOR EXISTING USERS. A user who already enabled Face ID has
//      the credential only in AsyncStorage. The first read finds it there, copies
//      it into the Keychain, deletes the plaintext copy, and returns it — the user
//      is never asked to re-enroll. If the Keychain WRITE fails mid-migration, the
//      legacy copy is KEPT (not deleted), so the user stays on the working old
//      path and simply migrates on a later launch. Losing the legacy copy before
//      the Keychain copy is durable is the one thing that would lock them out, so
//      the delete only ever runs after a confirmed write.

import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVICE = 'com.rpm.biometric';
const LEGACY_EMAIL_KEY = 'biometric_email';
const LEGACY_PASSWORD_KEY = 'biometric_password';

// WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: encrypted at rest, requires a device
// passcode, and never syncs to iCloud Keychain. We intentionally do NOT attach a
// biometric access-control to the item itself — the app already gates retrieval
// with react-native-biometrics (simplePrompt), and putting the gate on the
// Keychain item too would trigger a second, redundant Face ID sheet on read.
const KEYCHAIN_OPTS = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

async function clearLegacyAsyncStorage() {
  try {
    await AsyncStorage.removeItem(LEGACY_EMAIL_KEY);
    await AsyncStorage.removeItem(LEGACY_PASSWORD_KEY);
  } catch (e) {
    // Non-fatal: a lingering legacy key is re-cleared on the next successful read.
  }
}

// Persist the credential in the Keychain and remove any plaintext copy.
export async function saveBiometricCredentials(email, password) {
  await Keychain.setGenericPassword(email, password, KEYCHAIN_OPTS);
  await clearLegacyAsyncStorage();
}

// Return { email, password } or null. Never throws. Migrates a legacy
// AsyncStorage credential into the Keychain on the way (see property #2 above).
export async function getBiometricCredentials() {
  // 1) Keychain — the new home.
  try {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    if (creds && creds.username && creds.password) {
      return { email: creds.username, password: creds.password };
    }
  } catch (e) {
    // Fall through to the legacy store; do not throw (property #1).
    console.warn('[biometric] Keychain read failed:', e && e.message);
  }

  // 2) Legacy AsyncStorage (installs that enrolled before this change). Migrate.
  try {
    const email = await AsyncStorage.getItem(LEGACY_EMAIL_KEY);
    const password = await AsyncStorage.getItem(LEGACY_PASSWORD_KEY);
    if (email && password) {
      try {
        await Keychain.setGenericPassword(email, password, KEYCHAIN_OPTS);
        await clearLegacyAsyncStorage(); // only AFTER a confirmed Keychain write
      } catch (e) {
        // Keep the legacy copy so the user is not locked out; retry next launch.
        console.warn('[biometric] migration write failed, keeping legacy copy:', e && e.message);
      }
      return { email, password };
    }
  } catch (e) {
    console.warn('[biometric] legacy read failed:', e && e.message);
  }

  return null;
}

// Just the identifier, for the Face ID prompt message. Never throws.
export async function getBiometricEmail() {
  const creds = await getBiometricCredentials();
  return creds ? creds.email : null;
}

// True if a credential exists in either store. Never throws.
export async function hasBiometricCredentials() {
  const creds = await getBiometricCredentials();
  return creds != null;
}

// Remove the credential from BOTH stores (disable Face ID / logout).
export async function clearBiometricCredentials() {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch (e) {
    console.warn('[biometric] Keychain reset failed:', e && e.message);
  }
  await clearLegacyAsyncStorage();
}
