// Tests for the Face ID credential store + one-time AsyncStorage->Keychain
// migration. The migration/lockout cases are the ones that would strand a
// patient, so they are covered explicitly.

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'whenPasscode' },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveBiometricCredentials,
  getBiometricCredentials,
  clearBiometricCredentials,
  hasBiometricCredentials,
} from '../biometricCredentials';

const EMAIL_KEY = 'biometric_email';
const PW_KEY = 'biometric_password';

// In-memory backing so removeItem/setItem actually affect later reads.
let asyncMem;
let keychainMem;

beforeEach(() => {
  jest.clearAllMocks();
  asyncMem = {};
  keychainMem = null;

  AsyncStorage.getItem.mockImplementation(async (k) => (k in asyncMem ? asyncMem[k] : null));
  AsyncStorage.setItem.mockImplementation(async (k, v) => { asyncMem[k] = v; });
  AsyncStorage.removeItem.mockImplementation(async (k) => { delete asyncMem[k]; });

  Keychain.setGenericPassword.mockImplementation(async (username, password) => {
    keychainMem = { username, password };
    return true;
  });
  Keychain.getGenericPassword.mockImplementation(async () => (keychainMem ? { ...keychainMem } : false));
  Keychain.resetGenericPassword.mockImplementation(async () => { keychainMem = null; return true; });

  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('existing-user migration (the lockout-risk case)', () => {
  test('legacy AsyncStorage credential migrates into Keychain and the plaintext copy is deleted', async () => {
    asyncMem = { [EMAIL_KEY]: 'pat@x.com', [PW_KEY]: 'secret' };

    const creds = await getBiometricCredentials();

    // The user is returned their credential (never asked to re-enroll).
    expect(creds).toEqual({ email: 'pat@x.com', password: 'secret' });
    // It was written to the Keychain...
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('pat@x.com', 'secret', expect.any(Object));
    expect(keychainMem).toEqual({ username: 'pat@x.com', password: 'secret' });
    // ...and the plaintext copy was removed.
    expect(asyncMem[EMAIL_KEY]).toBeUndefined();
    expect(asyncMem[PW_KEY]).toBeUndefined();
  });

  test('if the Keychain WRITE fails mid-migration, the legacy copy is KEPT (not locked out)', async () => {
    asyncMem = { [EMAIL_KEY]: 'pat@x.com', [PW_KEY]: 'secret' };
    Keychain.setGenericPassword.mockRejectedValueOnce(new Error('keychain unavailable'));

    const creds = await getBiometricCredentials();

    // Still returned, so this login succeeds...
    expect(creds).toEqual({ email: 'pat@x.com', password: 'secret' });
    // ...and the legacy copy survives for a retry on a later launch.
    expect(asyncMem[EMAIL_KEY]).toBe('pat@x.com');
    expect(asyncMem[PW_KEY]).toBe('secret');
  });

  test('once migrated, the Keychain copy is used and AsyncStorage is not read', async () => {
    keychainMem = { username: 'pat@x.com', password: 'secret' };

    const creds = await getBiometricCredentials();

    expect(creds).toEqual({ email: 'pat@x.com', password: 'secret' });
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});

describe('fail-safe reads (never strand a patient)', () => {
  test('a Keychain read failure with no legacy copy returns null, does not throw', async () => {
    Keychain.getGenericPassword.mockRejectedValueOnce(new Error('boom'));

    await expect(getBiometricCredentials()).resolves.toBeNull();
  });

  test('a Keychain read failure still finds and migrates a legacy copy', async () => {
    asyncMem = { [EMAIL_KEY]: 'pat@x.com', [PW_KEY]: 'secret' };
    Keychain.getGenericPassword.mockRejectedValueOnce(new Error('boom'));

    const creds = await getBiometricCredentials();

    expect(creds).toEqual({ email: 'pat@x.com', password: 'secret' });
    expect(keychainMem).toEqual({ username: 'pat@x.com', password: 'secret' });
  });

  test('nothing stored anywhere -> null / hasBiometricCredentials false', async () => {
    expect(await getBiometricCredentials()).toBeNull();
    expect(await hasBiometricCredentials()).toBe(false);
  });
});

describe('save / clear', () => {
  test('save writes to Keychain and purges any legacy plaintext copy', async () => {
    asyncMem = { [EMAIL_KEY]: 'old@x.com', [PW_KEY]: 'oldpass' };

    await saveBiometricCredentials('new@x.com', 'newpass');

    expect(keychainMem).toEqual({ username: 'new@x.com', password: 'newpass' });
    expect(asyncMem[EMAIL_KEY]).toBeUndefined();
    expect(asyncMem[PW_KEY]).toBeUndefined();
  });

  test('clear removes the credential from BOTH stores', async () => {
    keychainMem = { username: 'a@x.com', password: 'b' };
    asyncMem = { [EMAIL_KEY]: 'a@x.com', [PW_KEY]: 'b' };

    await clearBiometricCredentials();

    expect(keychainMem).toBeNull();
    expect(asyncMem[EMAIL_KEY]).toBeUndefined();
    expect(asyncMem[PW_KEY]).toBeUndefined();
  });
});
