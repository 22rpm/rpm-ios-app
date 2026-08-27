// BloodPressure.js
import React, {useState, useMemo, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, {
  Polyline,
  Line as SvgLine,
  Circle,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import globalStyles from './globalStyles';
import ViatomDeviceManager from './ViatomDeviceManager';
import axios from 'axios';
import { drainOutbox } from './outbox';
import ReadingConfirmation from './ReadingConfirmation';
import { DEV_DATA_BASE } from './apiConfig';

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const getMarkerLeftPercent = systolic => {
  const min = 90;
  const max = 180;
  const v = clamp(systolic, min, max);
  return ((v - min) / (max - min)) * 100;
};

// API Configuration
// Base is centralized in apiConfig.js (single flip point for prod vs LAN).
const API_BASE_URL = DEV_DATA_BASE;
const DEV_TYPE = 'bp';

// Configure axios to include credentials
axios.defaults.withCredentials = true;

// Function to store device data
const storeDeviceData = async (deviceData) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`📡 [Attempt ${attempt}] Uploading BP data...`);
      await new Promise(res => setTimeout(res, 500));

      const response = await axios.post(
        `${API_BASE_URL}/devices/data`,
        deviceData,
        {
          withCredentials: true,
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        }
      );

      console.log('✅ Device data stored successfully');
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const msg = error.message;
      console.warn(`❌ Upload attempt ${attempt} failed`, status || msg);

      if (
        attempt < MAX_RETRIES &&
        (!status || status >= 500 || msg.includes('Network Error'))
      ) {
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
        continue;
      }

      throw error;
    }
  }
};

// Function to fetch historical data
const fetchHistoricalData = async (days = 7) => {
  try {
    console.log(`📥 Fetching historical BP data for last ${days} days`);
    const response = await axios.get(
      `${API_BASE_URL}/devices/getUserReadingData?deviceType=bp&days=${days}`,
      { withCredentials: true }
    );
    if (response.data.success) {
      console.log(`✅ Loaded ${response.data.data.records.length} historical records`);
      return response.data.data.records;
    }
    return [];
  } catch (error) {
    console.error('❌ Error fetching historical data:', error);
    throw error;
  }
};

function BPChart({width, data, xLabels}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const Y_MIN = 60;
  const Y_MAX = 160;
  const bracketLabels = [160, 135, 110, 85, 60];

  if (!data || data.length < 2) {
    return (
      <Svg width={w} height={h}>
        <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />
        <SvgText
          x={w / 2}
          y={h / 2}
          fontSize="12"
          fill="#7a7a7a"
          textAnchor="middle">
          Not enough data to show chart
        </SvgText>
      </Svg>
    );
  }

  const xFor = i => padding.left + (chartW / (data.length - 1)) * i;
  const yFor = val => padding.top + (Y_MAX - val) * (chartH / (Y_MAX - Y_MIN));

  const sysPoints = data.map((d, i) => `${xFor(i)},${yFor(d.systolic)}`).join(' ');
  const diaPoints = data.map((d, i) => `${xFor(i)},${yFor(d.diastolic)}`).join(' ');

  const diaAreaPoints = useMemo(() => {
    const topLine = data.map((d, i) => `${xFor(i)},${yFor(d.diastolic)}`).join(' ');
    const bottomRight = `${padding.left + chartW},${padding.top + chartH}`;
    const bottomLeft = `${padding.left},${padding.top + chartH}`;
    return `${topLine} ${bottomRight} ${bottomLeft}`;
  }, [chartW, chartH, data]);

  const todayX = xFor(data.length - 1);
  const todaySysY = yFor(data[data.length - 1].systolic);
  const todayDiaY = yFor(data[data.length - 1].diastolic);

  return (
    <Svg width={w} height={h}>
      <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />

      {[0.25, 0.5, 0.75].map(p => (
        <SvgLine
          key={`grid-${p}`}
          x1={padding.left}
          x2={padding.left + chartW}
          y1={padding.top + chartH * p}
          y2={padding.top + chartH * p}
          stroke="#e9ecef"
          strokeWidth="1"
        />
      ))}

      <SvgLine
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(120)}
        y2={yFor(120)}
        stroke="#7acb6a"
        strokeWidth="1.5"
      />
      <SvgLine
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(80)}
        y2={yFor(80)}
        stroke="#7acb6a"
        strokeWidth="1.5"
      />

      <Polygon points={diaAreaPoints} fill="#dfe4ea" opacity="0.5" />
      <Polyline points={diaPoints} fill="none" stroke="#7f8c8d" strokeWidth="1.5" />
      <Polyline points={sysPoints} fill="none" stroke="#4a4a4a" strokeWidth="1.5" />

      {data.map((d, i) => (
        <Circle
          key={`sys-dot-${i}`}
          cx={xFor(i)}
          cy={yFor(d.systolic)}
          r="4"
          fill="#ffffff"
          stroke="#4a4a4a"
          strokeWidth="1.5"
        />
      ))}

      {data.map((d, i) => {
        const cx = xFor(i);
        const cy = yFor(d.diastolic);
        const size = 6;
        const points = `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
        return (
          <Polygon key={`dia-tri-${i}`} points={points} fill="#4a4a4a" opacity="0.8" />
        );
      })}

      <SvgLine
        x1={padding.left + chartW + 10}
        x2={padding.left + chartW + 10}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#7aa9c9"
        strokeWidth="2"
      />
      <Circle
        cx={padding.left + chartW + 10}
        cy={todaySysY}
        r="6"
        stroke="#0d6ea5"
        strokeWidth="2"
        fill="#ffffff"
      />
      <Polygon
        points={`${padding.left + chartW + 10},${todayDiaY - 6} ${padding.left + chartW + 4},${todayDiaY + 6} ${padding.left + chartW + 16},${todayDiaY + 6}`}
        fill="#0d6ea5"
      />

      {bracketLabels.map(val => (
        <React.Fragment key={`br-${val}`}>
          <SvgLine
            x1={padding.left + chartW + 6}
            x2={padding.left + chartW + 14}
            y1={yFor(val)}
            y2={yFor(val)}
            stroke="#7aa9c9"
            strokeWidth="2"
          />
          <SvgText
            x={padding.left + chartW + 18}
            y={yFor(val) + 4}
            fill="#7a7a7a"
            fontSize="10">
            {val}
          </SvgText>
        </React.Fragment>
      ))}

      <SvgLine
        x1={todayX}
        x2={todayX}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#9ec6dd"
        strokeWidth="2"
      />

      {xLabels.map((lab, i) => (
        <SvgText
          key={`x-${lab}-${i}`}
          x={xFor(i)}
          y={padding.top + chartH + 18}
          fontSize="10"
          fill="#7a7a7a"
          textAnchor="middle">
          {lab}
        </SvgText>
      ))}
    </Svg>
  );
}

function BPMChart({width, data, xLabels}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const bpmVals = (data ?? []).map(d => Number(d.bpm)).filter(v => Number.isFinite(v));
  const rawMin = bpmVals.length ? Math.min(...bpmVals) : 50;
  const rawMax = bpmVals.length ? Math.max(...bpmVals) : 90;

  let Y_MIN = Math.max(40, Math.floor((rawMin - 5) / 5) * 5);
  let Y_MAX = Math.min(140, Math.ceil((rawMax + 5) / 5) * 5);
  if (Y_MAX - Y_MIN < 20) { Y_MIN = Math.max(40, Y_MIN - 5); Y_MAX = Math.min(140, Y_MAX + 5); }

  const bracketLabels = [];
  for (let v = Math.ceil(Y_MAX / 10) * 10; v >= Y_MIN; v -= 10) {
    bracketLabels.push(v);
  }

  if (!data || data.length < 2) {
    return (
      <Svg width={w} height={h}>
        <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />
        <SvgText
          x={w / 2}
          y={h / 2}
          fontSize="12"
          fill="#7a7a7a"
          textAnchor="middle">
          Not enough data to show chart
        </SvgText>
      </Svg>
    );
  }

  const xFor = i => padding.left + (chartW / (data.length - 1)) * i;
  const yFor = val => padding.top + (Y_MAX - Number(val)) * (chartH / (Y_MAX - Y_MIN));

  const bpmPoints = data.map((d, i) => `${xFor(i)},${yFor(d.bpm)}`).join(' ');
  const todayX = xFor(data.length - 1);
  const todayY = yFor(data[data.length - 1].bpm);

  return (
    <Svg width={w} height={h}>
      <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />

      {[0.25, 0.5, 0.75].map(p => (
        <SvgLine
          key={`grid-bpm-${p}`}
          x1={padding.left}
          x2={padding.left + chartW}
          y1={padding.top + chartH * p}
          y2={padding.top + chartH * p}
          stroke="#e9ecef"
          strokeWidth="1"
        />
      ))}

      {72 >= Y_MIN && 72 <= Y_MAX && (
        <SvgLine
          x1={padding.left}
          x2={padding.left + chartW}
          y1={yFor(72)}
          y2={yFor(72)}
          stroke="#7acb6a"
          strokeWidth="1.5"
        />
      )}

      <Polyline points={bpmPoints} fill="none" stroke="#4a4a4a" strokeWidth="1.5" />

      {data.map((d, i) => (
        <Circle
          key={`bpm-dot-${i}`}
          cx={xFor(i)}
          cy={yFor(d.bpm)}
          r="4"
          fill="#ffffff"
          stroke="#4a4a4a"
          strokeWidth="1.5"
        />
      ))}

      <SvgLine
        x1={padding.left + chartW + 10}
        x2={padding.left + chartW + 10}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#7aa9c9"
        strokeWidth="2"
      />
      <Circle
        cx={padding.left + chartW + 10}
        cy={todayY}
        r="6"
        stroke="#0d6ea5"
        strokeWidth="2"
        fill="#ffffff"
      />

      {bracketLabels.map(val => (
        <React.Fragment key={`bpm-br-${val}`}>
          <SvgLine
            x1={padding.left + chartW + 6}
            x2={padding.left + chartW + 14}
            y1={yFor(val)}
            y2={yFor(val)}
            stroke="#7aa9c9"
            strokeWidth="2"
          />
          <SvgText
            x={padding.left + chartW + 18}
            y={yFor(val) + 4}
            fill="#7a7a7a"
            fontSize="10">
            {val}
          </SvgText>
        </React.Fragment>
      ))}

      <SvgLine
        x1={todayX}
        x2={todayX}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#9ec6dd"
        strokeWidth="2"
      />

      {xLabels.map((lab, i) => (
        <SvgText
          key={`x-bpm-${lab}-${i}`}
          x={xFor(i)}
          y={padding.top + chartH + 18}
          fontSize="10"
          fill="#7a7a7a"
          textAnchor="middle">
          {lab}
        </SvgText>
      ))}
    </Svg>
  );
}

export default function BloodPressure({ navigation }) {
  // State Management
  const [activeTab, setActiveTab] = useState('LIST');
  const [devices, setDevices] = useState([]);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [realTimeData, setRealTimeData] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  // Add to your existing state management
const [manualConnectionMode, setManualConnectionMode] = useState(false);
const [selectedDevice, setSelectedDevice] = useState(null);
  const [connectionVerified, setConnectionVerified] = useState(false);
  // Q4/Q2: silent auto-reconnect status (no modal/toast churn while it tries).
  const [reconnecting, setReconnecting] = useState(false);
  // Q3: after a connect, prompt the patient to start the reading on the cuff.
  const [readyPrompt, setReadyPrompt] = useState(false);

  // Measurement State - Single source of truth
  const [measurementState, setMeasurementState] = useState({
    isMeasuring: false,
    isDeviceInitiated: false,
    hasError: false,
    error: null
  });

  // UI State
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(null);
  const [historicalData, setHistoricalData] = useState([]);
  const [filterDays, setFilterDays] = useState(7);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [deviceError, setDeviceError] = useState(null);

  const [processedResults, setProcessedResults] = useState(new Set());
  const [confirmation, setConfirmation] = useState(null); // { state:'sent'|'queued', sys, dia } | null
const processingRef = useRef(false);

  // Refs
  const toastTimeoutRef = useRef(null);
  const scanGuardRef = useRef(false);
  const connectedDeviceRef = useRef({
    name: null,
    id: null,
    batteryLevel: null
  });

  // Toast Management
  const showToastMessage = (message, duration = 2000) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    setShowToast(true);
    toastTimeoutRef.current = setTimeout(() => setShowToast(false), duration);
  };

  // Data Storage
  const storeMeasurementData = async (reading) => {
    try {
      const currentDevice = connectedDeviceRef.current;
      
      const deviceData = {
        devId: currentDevice?.id || 'bp_device_001',
        devType: DEV_TYPE,
        data: {
          systolic: reading.systolic,
          diastolic: reading.diastolic,
          pulse: reading.bpm,
          mean: reading.mean,
          timestamp: new Date().toISOString(),
          date: reading.date,
          time: reading.time,
          deviceInfo: {
            name: currentDevice?.name || 'Blood Pressure Monitor',
            id: currentDevice?.id || 'unknown_device_id',
            batteryLevel: currentDevice?.batteryLevel,
            type: 'viatom'
          }
        }
      };
      
      console.log('📤 Storing device data with battery:', deviceData);
      await storeDeviceData(deviceData);
      console.log('✅ Device data stored with battery info');

      loadHistoricalData(filterDays);
    } catch (error) {
      console.error('❌ Failed to store device data:', error);
      Alert.alert(
        'Data Upload Failed',
        'Unable to send blood pressure data to the server. Please check your internet connection or try again later.',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    }
  };

  // Clean up old processed results to prevent memory leaks
useEffect(() => {
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    setProcessedResults(prev => {
      const updated = new Set();
      // Keep only results from the last 5 minutes
      prev.forEach(key => {
        const timestamp = parseInt(key.split('_').pop());
        if (now - timestamp < 5 * 60 * 1000) { // 5 minutes
          updated.add(key);
        }
      });
      return updated;
    });
  }, 60000); // Clean every minute

  return () => clearInterval(cleanupInterval);
}, []);

  // Historical Data Management
const loadHistoricalData = async (days = 7) => {
  try {
    setIsLoading(true);
    const data = await fetchHistoricalData(days);
    const formattedData = data.map(item => {
      // Reading time = data.timestamp (native iso8601Now, a UTC "…Z" JSON string,
      // immune to the created_at TIMESTAMP tz mislabel — see bpReading.js /
      // TZ_FIX_DESIGN). createdAt is the outbox DELIVERY time, served ~7h off on dev;
      // fall back to it only for a legacy row. Also drives the sort, so history orders
      // by when the reading was TAKEN, not when it was delivered.
      const readingAt = (item.data && item.data.timestamp) || item.createdAt;
      return {
        id: item.id,
        date: new Date(readingAt).toLocaleDateString(),
        time: new Date(readingAt).toLocaleTimeString(),
        systolic: item.data.systolic,
        diastolic: item.data.diastolic,
        bpm: item.data.pulse,
        mean: item.data.mean,
        timestamp: readingAt,
      };
    });
    
    // Sort by timestamp in descending order (newest first) when loading
    const sortedData = formattedData.sort((a, b) => {
      const dateA = new Date(a.timestamp);
      const dateB = new Date(b.timestamp);
      return dateB - dateA; // Descending order (newest first)
    });
    
    setHistoricalData(sortedData);
    setFilterDays(days);
  } catch (error) {
    console.error('Error loading historical data:', error);
    showToastMessage('Failed to load historical data');
  } finally {
    setIsLoading(false);
    setRefreshing(false);
  }
};

// Add this useEffect to handle connection state synchronization
useEffect(() => {
  // Check if we have a connected device but UI shows disconnected
  if (connectedDeviceRef.current && !connectedDevice) {
    console.log('[UI] Synchronizing connection state - device is connected but UI shows disconnected');
    setConnectedDevice(connectedDeviceRef.current);
  }
}, [connectedDevice]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHistoricalData(filterDays);
  };

  const generateXLabels = (data) => {
    if (!data || data.length === 0) return ['No Data'];
    const dates = data.map(item => {
      const date = new Date(item.timestamp || item.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const uniqueDates = [...new Set(dates)].slice(-7);
    return uniqueDates;
  };

  const getDisplayData = () => {
    return [...historicalData].sort((a, b) => {
      const dateA = new Date(a.timestamp || a.date);
      const dateB = new Date(b.timestamp || b.date);
      return dateB - dateA;
    });
  };

  // Measurement State Management
  const updateMeasurementState = (updates) => {
    setMeasurementState(prev => ({
      ...prev,
      ...updates
    }));
  };

const resetMeasurementState = useCallback(() => {
  setMeasurementState({
    isMeasuring: false,
    isDeviceInitiated: false,
    hasError: false,
    error: null
  });
  setRealTimeData(null);
  // Don't reset processingRef here as we need it for deduplication
}, []);

  // Safe Scan Management
  const safeStartScan = useCallback(() => {
    if (scanGuardRef.current) return;
    scanGuardRef.current = true;
    console.log('[BLE] Safe scan start');
    ViatomDeviceManager.startScan?.();
    setTimeout(() => { scanGuardRef.current = false; }, 1500);
  }, []);

  // Device Connection Management
  const connectToDevice = (deviceId) => {
    console.log('[BLE] Connect to:', deviceId);
    ViatomDeviceManager.enableAutoReconnect?.(true);
    ViatomDeviceManager.connectToDevice?.(deviceId);
  };

  const disconnectDevice = () => {
    console.log('[BLE] Manual disconnect');
    ViatomDeviceManager.enableAutoReconnect?.(false);
    ViatomDeviceManager.disconnectDevice?.();
    setConnectedDevice(null);
    resetMeasurementState();
  };

  // Add this useEffect to auto-clear device errors after 5 seconds
useEffect(() => {
  if (deviceError && !deviceError.isCritical) {
    const timeoutId = setTimeout(() => {
      console.log('[UI] Auto-clearing non-critical device error');
      setDeviceError(null);
    }, 1000); // Clear after 5 seconds for non-critical errors
    
    return () => clearTimeout(timeoutId);
  }
}, [deviceError]);

  // Real-time Data Handler
// Deduplicated Real-time Data Handler
const handleRealTimeData = useCallback((data) => {
  if (!data || !data.type) return;

  // Handle battery updates
  if (data.type === 'BP_STATUS_UPDATE') {
    console.log('[UI] Battery update received:', data);
    if (typeof data.batteryLevel === 'number') {
      setBatteryLevel(data.batteryLevel);
      if (connectedDeviceRef.current) {
        connectedDeviceRef.current.batteryLevel = data.batteryLevel;
      }
    }
    return;
  }

  // Handle measurement progress
  if (data.type === 'BP_PROGRESS' && typeof data.pressure === 'number') {
    const defl = !!data.isDeflating;
    const infl = typeof data.isInflating === 'boolean' ? !!data.isInflating : !defl;
    const phase = data.phase || (defl ? 'deflating' : 'inflating');

    // Q3: the reading has started on the cuff — the "press start" prompt is done.
    if (readyPrompt) setReadyPrompt(false);

    setRealTimeData({
      type: 'BP_PROGRESS',
      pressure: Number(data.pressure) || 0,
      isDeflating: defl,
      isInflating: infl,
      phase,
      hasPulse: !!data.hasPulse,
      pulseRate: Number(data.pulseRate) || 0,
    });

    if (!defl && (data.pressure ?? 0) > 0) {
      showToastMessage('Inflating...', 1000);
    } else if (defl) {
      showToastMessage('Deflating...', 1000);
    }
    return;
  }

  // Handle final measurement result - WITH DEDUPLICATION
  // Disable final BP result here – handled in onMeasurementResult
    if (data.type === 'BP') {
      console.log('⚠️ Final BP ignored here – handled in onMeasurementResult');
      return;
    }

}, [processedResults]);

  // Event Subscriptions
  useEffect(() => {
    loadHistoricalData(7);

const discoverySubscription = ViatomDeviceManager.addListener('onDeviceDiscovered', (device) => {
  console.log('[BLE] Discovered:', device);
  const deviceWithSaved = {
    ...device,
    saved: device.saved || false // Add saved flag from native side
  };
  setDevices((prev) => (prev.find((d) => d.id === device.id) ? prev : [...prev, deviceWithSaved]));
});

// Replace your current connectionSubscription in useEffect
// Replace your current connectionSubscription in useEffect
// const connectionSubscription = ViatomDeviceManager.addListener('onDeviceConnected', (device) => {
//   console.log('[BLE] Connected:', device);
  
//   const deviceInfo = {
//    name: device.name || 'Unknown Device',
//     id: device.id,
//     batteryLevel: batteryLevel
//   };
  
//   setConnectedDevice(deviceInfo);
//   connectedDeviceRef.current = deviceInfo;
//   setConnectionVerified(true); // Mark connection as verified
//   console.log('💾 Stored device in ref:', connectedDeviceRef.current);
  
//   ViatomDeviceManager.requestDeviceInfo?.();
//   ViatomDeviceManager.requestBPConfig?.();
  
//   ViatomDeviceManager.stopScan?.();
  
//   // Force UI update
//   setConnectedDevice(prev => ({...prev}));
// });
const connectionSubscription = ViatomDeviceManager.addListener('onDeviceConnected', (device) => {
  console.log('[BLE] Connected:', device);
  
  // CLEAR ANY PREVIOUS DEVICE ERRORS WHEN CONNECTION SUCCEEDS
  setDeviceError(null); // ADD THIS LINE
  
  const deviceInfo = {
    name: device.name || 'Unknown Device',
    id: device.id,
    batteryLevel: batteryLevel
  };
  
  setConnectedDevice(deviceInfo);
  connectedDeviceRef.current = deviceInfo;
  setConnectionVerified(true);
  console.log('💾 Stored device in ref:', connectedDeviceRef.current);

  // Q2/Q3: the connect succeeded — end the silent reconnect, auto-dismiss the
  // device picker (no manual "close"), and prompt the patient to start the reading.
  setReconnecting(false);
  setShowDeviceModal(false);
  setReadyPrompt(true);

  ViatomDeviceManager.requestDeviceInfo?.();
  ViatomDeviceManager.requestBPConfig?.();

  ViatomDeviceManager.stopScan?.();

  // Force UI update
  setConnectedDevice(prev => ({...prev}));
});

const disconnectionSubscription = ViatomDeviceManager.addListener('onDeviceDisconnected', (payload) => {
  console.log('[BLE] Disconnected:', payload);
  setConnectedDevice(null);
  connectedDeviceRef.current = null;
  setConnectionVerified(true); // Mark disconnection as verified
  setReadyPrompt(false);       // Q3: the ready prompt is stale once disconnected
  resetMeasurementState();

  // Force UI update
  setConnectedDevice(null);

  // Q4: the cuff commonly powers off after a reading. The NATIVE manager now
  // owns the bounded reconnect (didDisconnect arms a 15s window and stops on
  // its own), so JS just shows the banner. No JS-side respin here — that was
  // the latent unbounded loop: setTimeout(safeStartScan) with no stop condition
  // spun the same way as the tap-with-cuff-off case if the cuff stayed off.
  setReconnecting(true);
});

    const dataSubscription = ViatomDeviceManager.addListener('onRealTimeData', (data) => {
      console.log('[DATA] onRealTimeData:', data);
      handleRealTimeData(data);
    });

const resultSubscription = ViatomDeviceManager.addListener('onMeasurementResult', (evt) => {
  if (evt?.type !== 'BP_RESULT') return;
  
  console.log('[BP] Final Result received:', evt);

  // Create unique key for this result
  const resultKey = `result_${evt.systolic}_${evt.diastolic}_${evt.pulse}_${Date.now()}`;
  
  // Check for duplicates
  if (processingRef.current || processedResults.has(resultKey)) {
    console.log('🔄 Duplicate onMeasurementResult detected, skipping:', resultKey);
    return;
  }

  processingRef.current = true;
  setProcessedResults(prev => new Set([...prev, resultKey]));

  resetMeasurementState();

  // The reading was already written to the durable outbox by native, BEFORE this
  // event fired (write-first). This handler is best-effort: show the result from
  // the event payload, then trigger a delivery drain. If the POST fails, the row
  // stays queued and a later drain (screen focus / app start) delivers it. The
  // outbox is the SINGLE write path now — do not add a direct POST here, or the
  // two paths would use different timestamps and defeat server-side dedup.
  const sys = Number(evt.systolic);
  const dia = Number(evt.diastolic);
  const pulse = Number(evt.pulse);
  const mean = Number(evt.meanPressure);

  setRealTimeData({ type: 'BP', systolic: sys, diastolic: dia, pulse, mean, phase: 'done' });
  showToastMessage(
    `Measurement Complete: ${sys}/${dia} mmHg, Pulse: ${pulse} BPM`,
    3000
  );

  drainOutbox()
    .then(async () => {
      // "Sent" = THIS reading is no longer in the outbox (a confirmed POST), not
      // merely captured. If it's still queued (offline / POST unconfirmed), show the
      // "saved, will send" state — never "sent". See ReadingConfirmation.
      let stillQueued = false;
      try {
        const pending = (await ViatomDeviceManager.getPendingResults()) || [];
        stillQueued = pending.some(
          (r) => Number(r.systolic) === sys && Number(r.diastolic) === dia && Number(r.pulse) === pulse
        );
      } catch (e) {}
      if (!stillQueued) loadHistoricalData(filterDays);
      setConfirmation({ state: stillQueued ? 'queued' : 'sent', sys, dia });
    })
    .catch((err) => {
      // Drain threw — the reading is safely captured and queued; reassure, don't claim sent.
      console.warn('Outbox drain error:', err?.message);
      setConfirmation({ state: 'queued', sys, dia });
    })
    .finally(() => {
      setTimeout(() => { processingRef.current = false; }, 2000);
    });
});

    const statusSubscription = ViatomDeviceManager.addListener('onBPStatusChanged', (payload) => {
      console.log('[BP] Status:', payload);
      
      switch (payload?.status) {
        case 'measurement_started':
          // SAFETY: clear any prior result the instant a new measurement starts,
          // regardless of whether this measurement's packets ever arrive. Without
          // this, a reading that produces no result packet leaves the PREVIOUS
          // reading's value on screen — a patient could read a number that was
          // never theirs. Independent of the packet-loss root cause.
          setRealTimeData(null);
          updateMeasurementState({
            isMeasuring: true,
            isDeviceInitiated: payload.deviceInitiated || false,
            hasError: false,
            error: null
          });
          showToastMessage('Measurement started');
          break;
          
        case 'measurement_completed':
          updateMeasurementState({ isMeasuring: false });
          showToastMessage('Measurement complete before final ready');
          break;
          
        case 'measurement_stopped':
        case 'measurement_aborted':
          resetMeasurementState();
          showToastMessage(payload.reason === 'manual_stop' ? 'Measurement stopped before completion' : 'Measurement stopped');
          break;
          
        default:
          break;
      }
    });

    const errorSubscription = ViatomDeviceManager.addListener('onDeviceError', (error) => {
      console.log('[BP] Device Error:', error);
      
      setDeviceError({
        code: error.error,
        message: error.message,
        isCritical: error.isCritical || false,
        timestamp: Date.now()
      });
      
      // Reset measurement state on any device error
      if (measurementState.isMeasuring) {
        resetMeasurementState();
      }
      
      // Show appropriate message based on error code
      let userMessage = error.message;
      switch (error.error) {
        case 'DEVICE_BUSY':
          userMessage = 'Device is busy. Please wait or restart the device.';
          break;
        case 'MEASUREMENT_STOPPED':
          userMessage = 'Measurement was stopped. Please try again.';
          break;
        case 'CRC_ERROR':
        case 'HEADER_ERROR':
          userMessage = 'Communication error. Please reconnect the device.';
          break;
        case 'DEVICE_DISCONNECTED':
          userMessage = 'Device disconnected. Please reconnect.';
          break;
        case 'MEASUREMENT_TIMEOUT':
          userMessage = 'Measurement timeout. Please try again.';
          break;
      }
      
      showToastMessage(userMessage, 4000);
    });

    // Q4: native emits this ONCE when the bounded 15s reconnect window expires
    // without connecting. Silent-forever is the failure mode that costs
    // transmission days, so the patient gets one clear message + the manual
    // picker as the single next action.
    const reconnectFailedSubscription = ViatomDeviceManager.addListener('onReconnectFailed', (payload) => {
      console.log('[BP] Reconnect failed (window expired):', payload);
      setReconnecting(false);
      setConnectionVerified(true);
      showToastMessage(
        payload?.message || "Couldn't connect to the cuff. Check that it's turned on.",
        6000
      );
      setShowDeviceModal(true);
    });

    return () => {
      discoverySubscription.remove();
      connectionSubscription.remove();
      disconnectionSubscription.remove();
      dataSubscription.remove();
      resultSubscription.remove();
      statusSubscription.remove();
      errorSubscription.remove();
      reconnectFailedSubscription.remove();

      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);


  

  // Screen Focus Management
// Screen Focus Management
useFocusEffect(
  useCallback(() => {
    console.log('[BP] Screen focused, checking connection state');

    // Deliver anything left in the durable outbox from a previous session (e.g.
    // a reading taken while offline, or one whose delivery was interrupted).
    drainOutbox().catch(() => {});

    // Q4/Q2: clean auto-reconnect, now owned by the NATIVE manager. beginReconnect
    // arms a bounded 15s window and scans; the native side reconnects to the saved
    // UUID quietly — NO modal, NO toast, no resetting an existing connection. The
    // patient just sees "Reconnecting…". If the cuff doesn't connect within the
    // window, native stops on its own and emits onReconnectFailed (handled in the
    // listener above), which surfaces one clear message + the manual picker. No JS
    // retry timer here — that timer's stopScan was overridden by the native loop.
    ViatomDeviceManager.enableAutoReconnect?.(true);

    // Use the REF, not the connectedDevice state, and depend on nothing — so this
    // effect (and its cancelReconnect cleanup) runs only on real focus/blur, never
    // on a connect/disconnect transition. Previously the [connectedDevice] dep made
    // a mid-session disconnect (setConnectedDevice(null)) fire the cleanup ->
    // cancelReconnect, which tore down the window didDisconnect had just armed and
    // dropped didFailToConnect into the unbounded generic-error branch — the Test B
    // lockout. A mid-session disconnect is now owned entirely by native didDisconnect
    // (which arms the bounded window); JS must not cancel it.
    if (connectedDeviceRef.current) {
      console.log('[BP] Already connected:', connectedDeviceRef.current.name);
      setConnectionVerified(true);
      return undefined;
    }

    console.log('[BP] Not connected — starting bounded auto-reconnect');
    setReconnecting(true);
    ViatomDeviceManager.beginReconnect?.();

    // Leaving the SCREEN must stop the native loop. This cleanup now fires only on
    // blur/unmount (empty deps), not on a disconnect.
    return () => {
      ViatomDeviceManager.cancelReconnect?.();
      setReconnecting(false);
    };
  }, [])
);



// Add this useEffect to verify connection state on component mount
useEffect(() => {
  // Initial connection state verification
  const verifyInitialConnectionState = async () => {
    console.log('[BP] Verifying initial connection state...');
    
    // Start with disconnected state
    setConnectedDevice(null);
    connectedDeviceRef.current = null;
    
    // Small delay to ensure Bluetooth stack is ready
    setTimeout(() => {
      // If we don't have a verified connection after 2 seconds, 
      // assume we're actually disconnected
      if (!connectionVerified) {
        console.log('[BP] No connection verified, assuming disconnected state');
        setConnectionVerified(true);
      }
    }, 2000);
  };

  verifyInitialConnectionState();
}, []);

  // Scanning Management
  const startScanning = () => {
    console.log('[BLE] Start scanning (manual)');
    setDevices([]);
    setIsScanning(true);
    safeStartScan();
    setTimeout(() => {
      setIsScanning(false);
      ViatomDeviceManager.stopScan?.();
    }, 10000);
  };

  const stopScanning = () => {
    console.log('[BLE] Stop scanning');
    setIsScanning(false);
    ViatomDeviceManager.stopScan?.();
  };

  // Return to wherever we were pushed from (PatientHome or the classic Home),
  // not a hardcoded 'Home' route — which pushed the OLD home on top of the stack.
  const handleBack = () =>
    navigation?.canGoBack?.() ? navigation.goBack() : navigation?.navigate?.('Home');

  // Error Display Component
  const renderErrorDisplay = () => {
    if (!deviceError) return null;
    
    return (
      <View style={[
        styles.errorContainer,
        deviceError.isCritical && styles.criticalErrorContainer
      ]}>
        <Text style={styles.errorTitle}>
          {deviceError.isCritical ? 'Critical Device Error' : 'Device Error'}
        </Text>
        <Text style={styles.errorMessage}>{deviceError.message}</Text>
        <Text style={styles.errorCode}>Code: {deviceError.code}</Text>
        
        <TouchableOpacity 
          style={styles.dismissErrorButton}
          onPress={() => setDeviceError(null)}
        >
          <Text style={styles.dismissErrorText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Connection Status Component
// Enhanced Connection Status Component
// Enhanced Connection Status Component with proper state handling
const renderConnectionStatus = () => {
  // Show connecting state when we're actively trying to connect
  const isConnecting = !connectedDevice && connectionVerified && devices.length > 0;
  
  return (
    <View style={styles.deviceRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Image
          source={require('./assets/device_bp.png')}
          style={[
            styles.deviceImage, 
            { 
              borderColor: connectedDevice ? globalStyles.primaryColor.color : 
                           isConnecting ? '#ffa726' : '#ccc',
              opacity: connectedDevice ? 1 : 0.6
            }
          ]}
          resizeMode="contain"
        />
        
        <View>
          <Text style={styles.deviceName}>
            {connectedDevice?.name || 'Blood Pressure Monitor'}
          </Text>
          <Text style={[
            styles.connectedText, 
            { 
              color: connectedDevice ? globalStyles.primaryColor.color : 
                     isConnecting ? '#ffa726' : '#666'
            }
          ]}>
            {connectedDevice ? 'Connected' : 
             isConnecting ? 'Connecting...' : 'Disconnected'}
          </Text>
        </View>
      </View>
      
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {batteryLevel !== null && connectedDevice && (
          <View style={[styles.batteryPill, { borderColor: '#E5E7EB', marginRight: 10 }]}>
            <Text style={styles.batteryText}>{batteryLevel}%</Text>
          </View>
        )}
        
        <TouchableOpacity 
          style={[
            styles.connectButton,
            connectedDevice ? styles.disconnectButtonStyle : 
            isConnecting ? styles.connectingButtonStyle : styles.connectButtonStyle
          ]}
          onPress={connectedDevice ? disconnectDevice : () => setShowDeviceModal(true)}
          disabled={isConnecting}
        >
          <Text style={[
            styles.connectButtonText,
            connectedDevice ? styles.disconnectButtonTextStyle : 
            isConnecting ? styles.connectingButtonTextStyle : styles.connectButtonTextStyle
          ]}>
            {connectedDevice ? 'Disconnect' : 
             isConnecting ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

  // Device Controls Component
  const renderDeviceControls = () => (
    <View style={styles.controlsContainer}>
      <Text style={{ 
        textAlign: 'center', 
        color: '#666', 
        fontSize: 14,
        marginBottom: 10
      }}>
        Measurement will start automatically when you press the button on your BP device.
      </Text>
      
      {measurementState.isMeasuring && (
        <View style={styles.measuringStatus}>
          <ActivityIndicator size="small" color={globalStyles.primaryColor.color} />
          <Text style={styles.measuringStatusText}>
            {measurementState.isDeviceInitiated ? 'Device-initiated' : 'App-initiated'} measurement in progress...
          </Text>
        </View>
      )}
    </View>
  );

  // Real-time Data Display
// Enhanced Real-time Data Display with Live Pressure
const renderRealTimeData = () => {
  if (!realTimeData) return null;

  return (
    <View style={styles.realTimeContainer}>
      <Text style={styles.realTimeTitle}>
        {realTimeData.type === 'BP_PROGRESS' ? 'Live Measurement' : 'Measurement Result'}
      </Text>

      {realTimeData.type === 'BP_PROGRESS' && (
        <>
          {/* Live Pressure Display - More Prominent */}
          <View style={styles.livePressureContainer}>
            <Text style={styles.livePressureLabel}>CURRENT PRESSURE</Text>
            <Text style={[
              styles.livePressureValue,
              { color: realTimeData.pressure > 180 ? '#e74c3c' : 
                      realTimeData.pressure > 120 ? '#f39c12' : '#3498db' }
            ]}>
              {Math.round(realTimeData.pressure)} mmHg
            </Text>
            <View style={styles.pressureTrend}>
              <Text style={styles.pressureTrendText}>
                {realTimeData.isInflating ? '🔼 Inflating' : '🔽 Deflating'}
              </Text>
            </View>
          </View>

          <View style={styles.measurementDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Status:</Text>
              <Text style={[
                styles.detailValue,
                { color: realTimeData.isDeflating ? '#f39c12' : '#3498db' }
              ]}>
                {realTimeData.isDeflating ? 'Deflating' : 'Inflating'}
              </Text>
            </View>

            {realTimeData.hasPulse && realTimeData.pulseRate > 0 && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Pulse Detected:</Text>
                <Text style={[styles.detailValue, { color: '#27ae60' }]}>
                  {realTimeData.pulseRate} BPM
                </Text>
              </View>
            )}
          </View>
        </>
      )}

      {realTimeData.type === 'BP' && (
        <>
          <View style={styles.finalResultContainer}>
            <Text style={styles.finalResultLabel}>FINAL RESULT</Text>
            <Text style={styles.finalResultValue}>
              {realTimeData.systolic ?? 0}/{realTimeData.diastolic ?? 0} mmHg
            </Text>
          </View>

          <View style={styles.measurementDetails}>
            {typeof realTimeData.mean === 'number' && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Mean Pressure:</Text>
                <Text style={styles.detailValue}>{realTimeData.mean} mmHg</Text>
              </View>
            )}

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Pulse Rate:</Text>
              <Text style={[styles.detailValue, { color: '#27ae60' }]}>
                {realTimeData.pulse ?? 0} BPM
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Measurement Progress Indicator */}
      {/* {measurementState.isMeasuring && (
        <View style={styles.measuringIndicator}>
          <ActivityIndicator size="small" color={globalStyles.primaryColor.color} />
          <Text style={styles.measuringText}>
            {realTimeData.type === 'BP_PROGRESS' ? 
             `Measuring... ${Math.round(realTimeData.pressure)} mmHg` : 
             'Measurement in progress...'}
          </Text>
        </View>
      )} */}
    </View>
  );
};

  // Device Connection Modal
// Enhanced Device Connection Modal with Manual Controls
const renderDeviceConnectionModal = () => (
  <Modal
    visible={showDeviceModal}
    transparent
    animationType="fade"
    onRequestClose={() => {
      setShowDeviceModal(false);
      setManualConnectionMode(false);
      setSelectedDevice(null);
      if (isScanning) stopScanning();
    }}
    onShow={() => {
      if (!connectedDevice) startScanning();
    }}
  >
    <View style={styles.modalOverlay}>
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>
          {manualConnectionMode ? 'Select Device to Connect' : 'Connect to BP Device'}
        </Text>

        {connectedDevice ? (
          <View style={styles.connectedStatusContainer}>
            <View style={styles.connectedIcon}>
              <Text style={styles.connectedIconText}>✓</Text>
            </View>
            <Text style={styles.connectedStatusText}>
              Connected to {connectedDevice.name}
            </Text>
            <TouchableOpacity 
              style={styles.disconnectButton}
              onPress={disconnectDevice}
            >
              <Text style={styles.disconnectButtonText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.modalSubtitle}>
              {isScanning 
                ? 'Scanning for devices...' 
                : manualConnectionMode
                ? 'Select a device to connect manually'
                : 'Auto-connect is enabled for saved devices'}
            </Text>

            {/* Manual Connection Toggle */}
            <View style={styles.manualToggleContainer}>
              <Text style={styles.manualToggleLabel}>Manual Connection</Text>
              <TouchableOpacity
                style={[
                  styles.toggleSwitch,
                  manualConnectionMode && styles.toggleSwitchActive
                ]}
                onPress={() => {
                  const newMode = !manualConnectionMode;
                  setManualConnectionMode(newMode);
                  if (newMode && !isScanning) {
                    startScanning();
                  }
                }}
              >
                <View style={[
                  styles.toggleKnob,
                  manualConnectionMode && styles.toggleKnobActive
                ]} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.deviceList} showsVerticalScrollIndicator={false}>
              {devices.length === 0 ? (
                <View style={styles.noDevicesContainer}>
                  <Text style={styles.noDevicesText}>
                    {isScanning 
                      ? 'Scanning for devices...' 
                      : 'No devices found. Tap "Scan" to search.'}
                  </Text>
                </View>
              ) : (
                devices.map((d, idx) => (
                  <TouchableOpacity
                    key={`${d.id ?? idx}`}
                    style={[
                      styles.deviceItem,
                      selectedDevice?.id === d.id && styles.deviceItemSelected
                    ]}
                    onPress={() => {
                      if (manualConnectionMode) {
                        setSelectedDevice(d);
                      } else {
                        connectToDevice(d.id);
                      }
                    }}
                  >
                    <View style={styles.deviceIcon}>
                      <Image 
                        source={require('./assets/device_bp.png')} 
                        style={styles.deviceIconImage}
                        resizeMode="contain"
                      />
                    </View>
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName}>{d.name ?? 'Unknown Device'}</Text>
                      {d.id && <Text style={styles.deviceId}>{d.id}</Text>}
                      {d.saved && <Text style={styles.savedDeviceBadge}>Saved Device</Text>}
                    </View>
                    <View style={[
                      styles.connectIndicator,
                      manualConnectionMode && selectedDevice?.id === d.id && styles.connectIndicatorSelected
                    ]}>
                      <Text style={styles.connectIndicatorText}>
                        {manualConnectionMode 
                          ? selectedDevice?.id === d.id ? 'Selected' : 'Select'
                          : 'Connect'
                        }
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <View style={styles.modalButtons}>
              {manualConnectionMode ? (
                <>
                  {selectedDevice && (
                    <TouchableOpacity 
                      style={styles.primaryButton} 
                      onPress={() => connectToDevice(selectedDevice.id)}
                    >
                      <Text style={styles.primaryButtonText}>
                        Connect to {selectedDevice.name}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {!isScanning ? (
                    <TouchableOpacity style={styles.secondaryButton} onPress={startScanning}>
                      <Text style={styles.secondaryButtonText}>Scan for Devices</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.secondaryButton} onPress={stopScanning}>
                      <Text style={styles.secondaryButtonText}>Stop Scanning</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <>
                  {!isScanning ? (
                    <TouchableOpacity style={styles.primaryButton} onPress={startScanning}>
                      <Text style={styles.primaryButtonText}>Scan for Devices</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.secondaryButton} onPress={stopScanning}>
                      <Text style={styles.secondaryButtonText}>Stop Scanning</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </>
        )}

        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => {
            setShowDeviceModal(false);
            setManualConnectionMode(false);
            setSelectedDevice(null);
            if (isScanning) stopScanning();
          }}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

  // Filter Modal
  const renderFilterModal = () => (
    <Modal
      visible={showFilterModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowFilterModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Select Time Period</Text>
          <Text style={styles.modalSubtitle}>Show data from last:</Text>

          {[7, 14, 21, 30].map(days => (
            <TouchableOpacity
              key={days}
              style={[styles.filterOption, filterDays === days && styles.filterOptionActive]}
              onPress={() => { loadHistoricalData(days); setShowFilterModal(false); }}
            >
              <Text style={[styles.filterOptionText, filterDays === days && styles.filterOptionTextActive]}>
                {days} {days === 1 ? 'Day' : 'Days'}
              </Text>
              {filterDays === days && <Text style={styles.selectedIndicator}>✓</Text>}
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.cancelButton} onPress={() => setShowFilterModal(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // Data Processing
  const displayData = getDisplayData();
  const chartData = [...historicalData].sort((a, b) => {
    const dateA = new Date(a.timestamp || a.date);
    const dateB = new Date(b.timestamp || b.date);
    return dateA - dateB;
  });
  const xLabels = generateXLabels(chartData);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack}>
            <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Blood Pressure</Text>
        </View>
      </SafeAreaView>

      {/* Q4: silent reconnect status (no modal churn) */}
      {reconnecting && !connectedDevice && (
        <View style={styles.reconnectBanner}>
          <ActivityIndicator size="small" color={globalStyles.primaryColor.color} />
          <Text style={styles.reconnectBannerText}>Reconnecting to your device…</Text>
        </View>
      )}
      {/* Q3: after connect, tell the patient the next step */}
      {readyPrompt && connectedDevice && (
        <View style={styles.readyBanner}>
          <Text style={styles.readyBannerText}>
            Connected. Press Start on the BP machine to take your reading.
          </Text>
        </View>
      )}

      {renderConnectionStatus()}
      {renderErrorDisplay()}
      {renderDeviceControls()}
      {renderRealTimeData()}

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'LIST' && styles.activeTab]}
          onPress={() => setActiveTab('LIST')}>
          <Text style={[styles.tabText, activeTab === 'LIST' && styles.activeTabText]}>
            LIST
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'GRAPH' && styles.activeTab]}
          onPress={() => setActiveTab('GRAPH')}>
          <Text style={[styles.tabText, activeTab === 'GRAPH' && styles.activeTabText]}>
            GRAPH
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'LIST' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[globalStyles.primaryColor.color]}
            />
          }>
          {historicalData.length > 0 && (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>
                Last {filterDays} Days
              </Text>
            </View>
          )}

          {historicalData.length === 0 ? (
            <View style={{padding: 20, alignItems: 'center'}}>
              <Text style={{color: '#666'}}>No blood pressure readings yet.</Text>
            </View>
          ) : (
            <>
              {historicalData.map(item => (
                <View key={`historical-${item.id}`} style={styles.dayBlock}>
                  <View style={styles.dateHeader}>
                    <Text style={styles.dateHeaderText}>{item.date}</Text>
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.timeText}>{item.time}</Text>
                    <View style={styles.row}>
                      <Text style={styles.bpText}>
                        {item.systolic}/{item.diastolic}
                        <Text style={styles.unit}> mmHg</Text>
                      </Text>
                      <Text style={styles.bpmText}>
                        {item.bpm}
                        <Text style={styles.unitSmall}> bpm</Text>
                      </Text>
                    </View>

                    <View style={styles.colorBarWrapper}>
                      <View style={[styles.colorSegment, {backgroundColor: '#50b36d'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#9bd47d'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#ffd060'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#ffa43b'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#ff7a2b'}]} />

                      <View
                        style={[
                          styles.marker,
                          {left: `${getMarkerLeftPercent(item.systolic)}%`},
                        ]}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        <View style={{flex: 1}}>
          <ScrollView
            contentContainerStyle={styles.graphScrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[globalStyles.primaryColor.color]}
              />
            }>
            <View style={styles.graphHeader}>
              <Text style={styles.graphTitle}>Blood Pressure Trends</Text>
              <TouchableOpacity 
                style={styles.filterIconButton}
                onPress={() => setShowFilterModal(true)}
              >
                <Image 
                  source={require('./assets/filter_icon.png')} 
                  style={styles.filterIcon}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.graphCard}>
              <View style={styles.graphHeader}>
                <View style={[styles.iconCircle, {backgroundColor: '#7acb6a'}]}>
                  <Text style={styles.iconText}>👤</Text>
                </View>
                <Text style={styles.graphTitleBlue}>BLOOD PRESSURE</Text>
                <View style={{flex: 1}} />
                <Text style={styles.legendRight}>SYS ○ / DIA ▲</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <View style={{flex: 1}}>
                  <Text style={styles.smallMuted}>Today</Text>
                  <Text style={styles.smallMuted}>
                    {displayData[0]?.time ?? '—'}
                  </Text>
                  <Text style={styles.goalText}>
                    Your goal: SYS 120 / DIA 80
                  </Text>
                </View>
                <Text style={styles.bigReading}>
                  {displayData[0]
                    ? `${displayData[0].systolic}/${displayData[0].diastolic}`
                    : '—/—'}{' '}
                  <Text style={styles.mmHg}>mmHg</Text>
                </Text>
              </View>

              <BPChart
                width={SCREEN_WIDTH - 20}
                data={chartData}
                xLabels={xLabels}
              />
            </View>

            <View style={styles.graphCard}>
              <View style={styles.graphHeader}>
                <View style={[styles.iconCircle, {backgroundColor: '#cfecc5'}]}>
                  <Text style={[styles.iconText, {color: '#59b54b'}]}>♥</Text>
                </View>
                <Text style={styles.graphTitleBlue}>PULSE RATE</Text>
                <View style={{flex: 1}} />
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <View style={{flex: 1}}>
                  <Text style={styles.smallMuted}>Today</Text>
                  <Text style={styles.smallMuted}>
                    {displayData[0]?.time ?? '—'}
                  </Text>
                  <Text style={styles.goalText}>Your goal: 72</Text>
                </View>
                <Text style={styles.bigReadingRight}>
                  {displayData[0] ? `${displayData[0].bpm}` : '—'}{' '}
                  <Text style={styles.mmHg}>bpm</Text>
                </Text>
              </View>

              <BPMChart
                width={SCREEN_WIDTH - 20}
                data={chartData}
                xLabels={xLabels}
              />
            </View>
          </ScrollView>
        </View>
      )}

      {renderDeviceConnectionModal()}
      {renderFilterModal()}

      <ReadingConfirmation
        visible={!!confirmation}
        state={confirmation?.state}
        systolic={confirmation?.sys}
        diastolic={confirmation?.dia}
        onClose={() => setConfirmation(null)}
      />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator
            size="large"
            color={globalStyles.primaryColor.color}
          />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      {showToast && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ebf2f9' },
  reconnectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#eef4fb',
  },
  reconnectBannerText: { color: '#334155', fontSize: 14 },
  readyBanner: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#e7f6ec',
  },
  readyBannerText: { color: '#166534', fontSize: 14, textAlign: 'center', fontWeight: '500' },
  header: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.08,
    backgroundColor: globalStyles.primaryColor.color,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: 10,
  },
  backIcon: {
    width: SCREEN_WIDTH * 0.06,
    height: SCREEN_WIDTH * 0.06,
    resizeMode: 'contain',
    tintColor: '#fff',
  },
  headerTitle: {
    color: 'white',
    fontSize: SCREEN_WIDTH * 0.05,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginRight: SCREEN_WIDTH * 0.08,
  },
  deviceRow: {
    backgroundColor: '#FFFFFF', 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#E5E7EB',
    padding: 12, 
    marginBottom: 12, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    marginHorizontal: 12,
    marginTop: 12,
  },
  deviceImage: {
    width: 42,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    marginRight: 10,
  },
  deviceName: { 
    color: '#111827', 
    fontSize: 16, 
    fontWeight: '700' 
  },
  connectedText: { 
    fontSize: 12, 
    marginTop: 2 
  },
  batteryPill: { 
    paddingHorizontal: 10, 
    paddingVertical: 6, 
    borderRadius: 999, 
    backgroundColor: '#FFFFFF', 
    borderWidth: 1 
  },
  batteryText: { 
    color: '#374151', 
    fontWeight: '700' 
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    borderLeftWidth: 4,
    borderLeftColor: '#f44336',
    padding: 16,
    margin: 10,
    borderRadius: 8,
  },
  criticalErrorContainer: {
    backgroundColor: '#ffcdd2',
    borderLeftColor: '#d32f2f',
  },
  errorTitle: {
    color: '#c62828',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 8,
  },
  errorMessage: {
    color: '#d32f2f',
    fontSize: 14,
    marginBottom: 4,
  },
  errorCode: {
    color: '#999',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  dismissErrorButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 8,
  },
  dismissErrorText: {
    color: '#1976d2',
    fontSize: 14,
    fontWeight: '500',
  },
  controlsContainer: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  measuringStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
    marginHorizontal: 10,
  },
  measuringStatusText: {
    marginLeft: 8,
    color: '#2e7d32',
    fontSize: 14,
    fontWeight: '500',
  },
  realTimeContainer: {
    backgroundColor: '#fff',
    padding: 18,
    margin: 10,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  realTimeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  measurementRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'center',
  },
  measurementLabel: {
    fontWeight: '600',
    color: '#666',
    fontSize: 14,
  },
  measurementValue: {
    color: '#333',
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
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
    maxWidth: 300
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: '#333',
  },
  modalSubtitle: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    color: '#666',
  },
  deviceList: {
    maxHeight: 200,
    width: '100%',
    marginVertical: 16,
  },
  noDevicesContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDevicesText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  deviceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  deviceIconImage: {
    width: 24,
    height: 24,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontWeight: '600',
    fontSize: 16,
    color: '#333',
  },
  deviceId: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  connectIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: globalStyles.primaryColor.color,
    borderRadius: 12,
  },
  connectIndicatorText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  modalButtons: {
    width: '100%',
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  secondaryButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    padding: 12,
    alignItems: 'center',
    width: '100%',
  },
  closeButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    width: '100%',
  },
  filterOptionActive: {
    backgroundColor: '#f8f9fa',
  },
  filterOptionText: {
    fontSize: 16,
    color: '#333',
  },
  filterOptionTextActive: {
    color: globalStyles.primaryColor.color,
    fontWeight: '600',
  },
  selectedIndicator: {
    color: globalStyles.primaryColor.color,
    fontSize: 18,
    fontWeight: 'bold',
  },
  cancelButton: {
    padding: 10,
    marginTop: 10,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    backgroundColor: globalStyles.primaryColor.color,
    paddingVertical: SCREEN_HEIGHT * 0.01,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: '#fff',
  },
  tabText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
  },
  graphScrollContent: {
    padding: 10,
  },
  graphHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  graphTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  filterIconButton: {
    padding: 8,
  },
  filterIcon: {
    width: 34,
    height: 34,
    tintColor: globalStyles.primaryColor.color,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: '#f8f9fa',
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: globalStyles.primaryColor.color,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  dayBlock: {
    marginBottom: 15,
  },
  dateHeader: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#e6f2ff',
    borderRadius: 6,
    marginBottom: 8,
  },
  dateHeaderText: {
    color: '#2c80ff',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  timeText: {
    color: '#666',
    fontSize: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bpText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  bpmText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  unit: {
    fontSize: 14,
    fontWeight: 'normal',
  },
  unitSmall: {
    fontSize: 12,
    fontWeight: 'normal',
  },
  colorBarWrapper: {
    height: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    position: 'relative',
  },
  colorSegment: {
    flex: 1,
    height: '100%',
  },
  marker: {
    position: 'absolute',
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#2c80ff',
  },
  graphCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  iconText: {
    fontSize: 16,
  },
  graphTitleBlue: {
    color: '#2c80ff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  legendRight: {
    color: '#666',
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  smallMuted: {
    color: '#666',
    fontSize: 12,
  },
  goalText: {
    color: '#2c80ff',
    fontSize: 12,
    marginTop: 4,
  },
  bigReading: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  bigReadingRight: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'right',
  },
  mmHg: {
    fontSize: 14,
    fontWeight: 'normal',
    color: '#666',
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
  toastContainer: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    zIndex: 1000,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  // Add these to your existing styles
livePressureContainer: {
  backgroundColor: '#f8f9fa',
  padding: 16,
  borderRadius: 12,
  alignItems: 'center',
  marginBottom: 16,
  borderWidth: 2,
  borderColor: '#e9ecef',
},
livePressureLabel: {
  fontSize: 12,
  fontWeight: '600',
  color: '#6c757d',
  marginBottom: 4,
  letterSpacing: 1,
},
livePressureValue: {
  fontSize: 32,
  fontWeight: 'bold',
  color: '#2c3e50',
  marginBottom: 8,
},
pressureTrend: {
  backgroundColor: '#e9ecef',
  paddingHorizontal: 12,
  paddingVertical: 4,
  borderRadius: 20,
},
pressureTrendText: {
  fontSize: 12,
  fontWeight: '600',
  color: '#495057',
},
finalResultContainer: {
  backgroundColor: '#d4edda',
  padding: 16,
  borderRadius: 12,
  alignItems: 'center',
  marginBottom: 16,
  borderWidth: 2,
  borderColor: '#c3e6cb',
},
finalResultLabel: {
  fontSize: 12,
  fontWeight: '600',
  color: '#155724',
  marginBottom: 4,
  letterSpacing: 1,
},
finalResultValue: {
  fontSize: 28,
  fontWeight: 'bold',
  color: '#155724',
},
measurementDetails: {
  backgroundColor: '#fff',
  padding: 12,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: '#e9ecef',
},
detailRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
},
detailLabel: {
  fontWeight: '600',
  color: '#6c757d',
  fontSize: 14,
},
detailValue: {
  color: '#2c3e50',
  fontWeight: 'bold',
  fontSize: 14,
},
// Add to your existing styles
manualToggleContainer: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingVertical: 12,
  paddingHorizontal: 16,
  backgroundColor: '#f8f9fa',
  borderRadius: 8,
  marginBottom: 16,
},
manualToggleLabel: {
  fontSize: 16,
  fontWeight: '600',
  color: '#333',
},
toggleSwitch: {
  width: 50,
  height: 28,
  borderRadius: 14,
  backgroundColor: '#e9ecef',
  padding: 2,
  justifyContent: 'center',
},
toggleSwitchActive: {
  backgroundColor: globalStyles.primaryColor.color,
},
toggleKnob: {
  width: 24,
  height: 24,
  borderRadius: 12,
  backgroundColor: '#fff',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.2,
  shadowRadius: 1,
  elevation: 2,
},
toggleKnobActive: {
  transform: [{ translateX: 22 }],
},
deviceItemSelected: {
  backgroundColor: '#e3f2fd',
  borderColor: globalStyles.primaryColor.color,
  borderWidth: 1,
},
connectIndicatorSelected: {
  backgroundColor: '#4caf50',
},
connectedStatusContainer: {
  alignItems: 'center',
  padding: 20,
},
connectedIcon: {
  width: 60,
  height: 60,
  borderRadius: 30,
  backgroundColor: '#4caf50',
  justifyContent: 'center',
  alignItems: 'center',
  marginBottom: 12,
},
connectedIconText: {
  color: '#fff',
  fontSize: 24,
  fontWeight: 'bold',
},
connectedStatusText: {
  fontSize: 18,
  fontWeight: '600',
  color: '#333',
  marginBottom: 16,
  textAlign: 'center',
},
savedDeviceBadge: {
  fontSize: 10,
  color: globalStyles.primaryColor.color,
  fontWeight: '600',
  marginTop: 2,
},
connectButton: {
  paddingHorizontal: 16,
  paddingVertical: 8,
  borderRadius: 20,
  minWidth: 100,
  alignItems: 'center',
},
connectButtonStyle: {
  backgroundColor: globalStyles.primaryColor.color,
},
disconnectButtonStyle: {
  backgroundColor: '#ff4444',
},
connectButtonText: {
  fontSize: 14,
  fontWeight: '600',
},
connectButtonTextStyle: {
  color: '#fff',
},
disconnectButtonTextStyle: {
  color: '#fff',
},
disconnectButton: {
  backgroundColor: '#ff4444',
  paddingHorizontal: 20,
  paddingVertical: 10,
  borderRadius: 8,
  marginTop: 8,
},
disconnectButtonText: {
  color: '#fff',
  fontWeight: '600',
},
// Add to your existing styles
connectingButtonStyle: {
  backgroundColor: '#ffa726',
},
connectingButtonTextStyle: {
  color: '#fff',
},
});