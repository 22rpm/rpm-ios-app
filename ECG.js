// ECG.js - iOS Version with Viatom SDK Integration
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
  StyleSheet,
  Dimensions,
  Image,
  NativeEventEmitter,
  NativeModules,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import globalStyles from './globalStyles';
const { width, height } = Dimensions.get('window');

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const { ViatomDeviceManager } = NativeModules;
const viatomEventEmitter = new NativeEventEmitter(ViatomDeviceManager);

const Ecg = ({ navigation }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState([]);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [realTimeData, setRealTimeData] = useState(null);
  const [connectedDevice, setConnectedDevice] = useState(null);

  const eventListeners = useRef([]);

  // Setup event listeners
  useEffect(() => {
    setupEventListeners();
    
    return () => {
      // Cleanup listeners
      eventListeners.current.forEach(listener => {
        listener.remove();
      });
      eventListeners.current = [];
    };
  }, []);

  const setupEventListeners = () => {
    const listeners = [
      viatomEventEmitter.addListener('onDeviceDiscovered', handleDeviceDiscovered),
      viatomEventEmitter.addListener('onDeviceConnected', handleDeviceConnected),
      viatomEventEmitter.addListener('onDeviceDisconnected', handleDeviceDisconnected),
      viatomEventEmitter.addListener('onRealTimeData', handleRealTimeData),
    ];

    eventListeners.current = listeners;
  };

  // Event Handlers
  const handleDeviceDiscovered = (device) => {
    if (device && device.id) {
      setDevices(prev => {
        if (!prev.find(d => d.id === device.id)) {
          return [...prev, device];
        }
        return prev;
      });
    }
  };

  const handleDeviceConnected = (device) => {
    setIsConnected(true);
    setConnectedDevice(device);
    setErrorMessage('');
    setIsLoading(false);
    setShowDeviceModal(false);
    console.log('Device connected:', device);
  };

  const handleDeviceDisconnected = (device) => {
    setIsConnected(false);
    setConnectedDevice(null);
    setRealTimeData(null);
    console.log('Device disconnected:', device);
  };

  const handleRealTimeData = (data) => {
    if (data.type === 'ECG') {
      setRealTimeData(data);
      console.log('ECG Real-time data:', data);
    }
  };

  // Device Operations
  const startScan = async () => {
    try {
      setIsScanning(true);
      setDevices([]);
      setErrorMessage('');
      setShowDeviceModal(true);
      await ViatomDeviceManager.startScan();
      
      // Auto stop scan after 15 seconds
      setTimeout(() => {
        stopScan();
        if (devices.length === 0) {
          setErrorMessage('No Viatom device found nearby');
        }
      }, 15000);
    } catch (error) {
      console.error('Scan error:', error);
      setErrorMessage('Failed to start scanning');
      setIsScanning(false);
    }
  };

  const stopScan = async () => {
    try {
      await ViatomDeviceManager.stopScan();
      setIsScanning(false);
    } catch (error) {
      console.error('Stop scan error:', error);
    }
  };

  const connectToDevice = async (device) => {
    if (!device || !device.id) {
      setErrorMessage('No valid device selected');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage('');
      await ViatomDeviceManager.connectToDevice(device.id);
    } catch (error) {
      console.error('Connection error:', error);
      setErrorMessage('Failed to connect to device');
      setIsLoading(false);
    }
  };

  const disconnectDevice = async () => {
    try {
      await ViatomDeviceManager.disconnectDevice();
      setIsConnected(false);
      setConnectedDevice(null);
      setRealTimeData(null);
    } catch (error) {
      console.error('Disconnection error:', error);
      setErrorMessage('Failed to disconnect device');
    }
  };

  // goBack() returns to the actual previous screen; hardcoding 'Home' pushed the
  // OLD home on top of the stack (wrong when reached from PatientHome).
  const handleBack = () =>
    navigation?.canGoBack?.() ? navigation.goBack() : navigation?.navigate?.('PatientHome');

  // UI Components
  const renderConnectionStatus = () => (
    <View style={styles.connectionStatus}>
      <View style={[styles.statusIndicator, { backgroundColor: isConnected ? '#4CAF50' : '#F44336' }]} />
      <Text style={styles.statusText}>
        {isConnected ? `Connected to ${connectedDevice?.name || 'Device'}` : 'Disconnected'}
      </Text>
      <TouchableOpacity 
        style={styles.connectButtonSmall} 
        onPress={isConnected ? disconnectDevice : () => setShowDeviceModal(true)}
      >
        <Text style={styles.connectButtonTextSmall}>
          {isConnected ? 'Disconnect' : 'Connect'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderDeviceConnectionModal = () => (
    <Modal visible={showDeviceModal} transparent animationType="slide" onRequestClose={() => setShowDeviceModal(false)}>
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Connect to Viatom Device</Text>

          {isLoading ? (
            <ActivityIndicator size="large" color={globalStyles.primaryColor.color} />
          ) : (
            <>
              <Text style={styles.modalText}>
                {isConnected ? 'Connected to device' : isScanning ? 'Scanning for devices...' : 'Select a device to connect'}
              </Text>

              {!isConnected && (
                <>
                  <ScrollView style={{ maxHeight: 200, width: '100%' }}>
                    {devices.length === 0 ? (
                      <Text style={{ textAlign: 'center', color: '#666', marginVertical: 10 }}>
                        {isScanning ? 'Scanning...' : 'No devices found'}
                      </Text>
                    ) : (
                      devices.map((device, index) => (
                        <TouchableOpacity
                          key={index}
                          style={styles.deviceItem}
                          onPress={() => connectToDevice(device)}
                        >
                          <Text style={styles.deviceName}>{device.name || 'Unknown Device'}</Text>
                          <Text style={styles.deviceAddress}>{device.id}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>

                  {!isScanning && (
                    <TouchableOpacity style={styles.scanButton} onPress={startScan}>
                      <Text style={styles.scanButtonText}>Scan Again</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowDeviceModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  const renderRealTimeData = () => {
    if (!realTimeData) return null;

    return (
      <View style={styles.realTimeContainer}>
        <Text style={styles.realTimeTitle}>ECG Real-time Data</Text>
        {realTimeData.heartRate && (
          <Text style={styles.dataText}>Heart Rate: {realTimeData.heartRate} bpm</Text>
        )}
        {realTimeData.waveform && (
          <View style={styles.waveformContainer}>
            <Text style={styles.waveformTitle}>Waveform Samples: {realTimeData.waveform.length}</Text>
            <ScrollView horizontal style={styles.waveformScroll}>
              <Text style={styles.waveformData}>
                {realTimeData.waveform.slice(0, 20).join(', ')}
                {realTimeData.waveform.length > 20 ? '...' : ''}
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
            <SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
  <View style={styles.header}>
    <TouchableOpacity onPress={handleBack}>
      <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>ECG</Text>

  </View>
</SafeAreaView>

      {errorMessage ? (
        <View style={styles.warningContainer}>
          <Text style={styles.warningText}>{errorMessage}</Text>
        </View>
      ) : null}

      {renderConnectionStatus()}
      {renderRealTimeData()}

      <TouchableOpacity
        onPress={startScan}
        style={styles.scanButtonLarge}
      >
        <Text style={styles.scanButtonTextLarge}>Scan for Devices</Text>
      </TouchableOpacity>

      {renderDeviceConnectionModal()}

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={globalStyles.primaryColor.color} />
          <Text style={styles.loadingText}>Processing...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ebf2f9',
  },
header: {
  width: '100%',
  paddingTop: StatusBar.currentHeight, // This adds padding for the status bar
  height: (height * 0.08) + StatusBar.currentHeight, // Add status bar height to your existing height
  backgroundColor: globalStyles.primaryColor.color,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 15,
},
  backIcon: { 
    width: width * 0.06, 
    height: width * 0.06, 
    resizeMode: 'contain', 
    tintColor: '#fff' 
  },
headerTitle: {
  color: 'white',
  fontSize: width * 0.05,
  fontWeight: 'bold',
  flex: 1,
  textAlign: 'center',
},
  warningContainer: {
    backgroundColor: '#ffebee',
    padding: 15,
    margin: 10,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#f44336',
  },
  warningText: {
    color: '#d32f2f',
    fontSize: 14,
    fontWeight: '500',
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#fff',
    margin: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  connectButtonSmall: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  connectButtonTextSmall: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  realTimeContainer: {
    backgroundColor: '#fff',
    padding: 15,
    margin: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  realTimeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  dataText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 8,
    fontWeight: '500',
  },
  waveformContainer: {
    marginTop: 10,
  },
  waveformTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
    color: '#333',
  },
  waveformScroll: {
    maxHeight: 60,
  },
  waveformData: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'Courier',
  },
  scanButtonLarge: {
    backgroundColor: globalStyles.primaryColor.color,
    padding: 15,
    margin: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  scanButtonTextLarge: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    width: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  deviceItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: '#eee',
    width: '100%',
  },
  deviceName: {
    fontWeight: '600',
    fontSize: 16,
  },
  deviceAddress: {
    color: '#666',
    fontSize: 12,
  },
  scanButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 10,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#333',
  },
});

export default Ecg;