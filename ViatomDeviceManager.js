// manager.js
//
// MAINTENANCE RULE: this is a hand-maintained WHITELIST wrapper over the native
// ViatomDeviceManager module. Any RCT_EXPORT_METHOD added on the native side MUST
// be added here too, or JS calls silently do nothing: `ViatomDeviceManager.foo?.()`
// on a method the wrapper doesn't declare resolves to `undefined`, and the `?.`
// swallows it with no error. Bare `.foo()` on a missing method throws instead.
// Keep this list in sync with the native RCT_EXPORT_METHOD surface. (Audit:
// `grep RCT_EXPORT_METHOD ViatomDeviceManager.m` vs the keys below.)
import { NativeEventEmitter, NativeModules } from 'react-native';

const { ViatomDeviceManager } = NativeModules;
const eventEmitter = new NativeEventEmitter(ViatomDeviceManager);

export default {
  // Scanning & Connection
  startScan: () => ViatomDeviceManager.startScan(),
  stopScan: () => ViatomDeviceManager.stopScan(),
  connectToDevice: (deviceId) => ViatomDeviceManager.connectToDevice(deviceId),
  disconnectDevice: () => ViatomDeviceManager.disconnectDevice(),

  // Auto-reconnect (bounded 15s window owned by native). These were called from
  // BloodPressure.js but never exposed here, so every call was a silent no-op —
  // focus-reconnect and blur-cancel did nothing.
  enableAutoReconnect: (enabled) => ViatomDeviceManager.enableAutoReconnect(enabled),
  beginReconnect: () => ViatomDeviceManager.beginReconnect(),
  cancelReconnect: () => ViatomDeviceManager.cancelReconnect(),

  // Blood Pressure Methods
  // startBPMeasurement: () => ViatomDeviceManager.startBPMeasurement(),
  // stopBPMeasurement: () => ViatomDeviceManager.stopBPMeasurement(),
  requestBPConfig: () => ViatomDeviceManager.requestBPConfig(),

  // NOTE: native method is requestBPRunStatus (not requestBPRealStatus)
  requestBPRunStatus: () => ViatomDeviceManager.requestBPRunStatus(),
  syncBPConfig: (config) => ViatomDeviceManager.syncBPConfig(config),

  // Device Info
  requestDeviceInfo: () => ViatomDeviceManager.requestDeviceInfo(),
  requestBatteryInfo: () => ViatomDeviceManager.requestBatteryInfo(),

  // Mode Switching
  enterECGMode: () => ViatomDeviceManager.enterECGMode(),
  enterHistoryMode: () => ViatomDeviceManager.enterHistoryMode(),
  // TEMP (device-history probe, 1.0.51): logs the device clock + stored-file list to the
  // native console. Remove once readStoredRecords lands.
  debugProbeHistory: () => ViatomDeviceManager.debugProbeHistory(),

  // Durable result outbox (readings persisted on-disk by native at parse time)
  getPendingResults: () => ViatomDeviceManager.getPendingResults(),
  clearPendingResult: (id) => ViatomDeviceManager.clearPendingResult(id),

  // Exposed for completeness so the wrapper matches the native surface (not yet
  // called from JS, but present so a future caller doesn't hit a silent no-op).
  forgetSavedDevice: () => ViatomDeviceManager.forgetSavedDevice(),
  setVoiceEnabled: (enabled) => ViatomDeviceManager.setVoiceEnabled(enabled),

  // Event Listeners
  addListener: (eventName, callback) => eventEmitter.addListener(eventName, callback),
  removeAllListeners: (eventName) => eventEmitter.removeAllListeners(eventName),
};
