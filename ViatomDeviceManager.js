// manager.js
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

  // Durable result outbox (readings persisted on-disk by native at parse time)
  getPendingResults: () => ViatomDeviceManager.getPendingResults(),
  clearPendingResult: (id) => ViatomDeviceManager.clearPendingResult(id),

  // Event Listeners
  addListener: (eventName, callback) => eventEmitter.addListener(eventName, callback),
  removeAllListeners: (eventName) => eventEmitter.removeAllListeners(eventName),
};
