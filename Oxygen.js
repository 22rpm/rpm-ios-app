// Oxygen.js – white background + colored header "Oxygen" + modern cards
// Keeps: realtime + PPG + session cards + auto-finalize + auto-reconnect

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  TouchableOpacity, 
  StyleSheet, 
  SafeAreaView, 
  Image,
  Dimensions,
  ScrollView,
  RefreshControl,
  ActivityIndicator
} from 'react-native';
import { Svg, Polyline, Line, Rect, Text as SvgText, Circle, G } from 'react-native-svg';

import O2 from './ViatomO2Manager';
import globalStyles from './globalStyles';
import axios from 'axios';
import SQLite from 'react-native-sqlite-storage';
import { DEV_DATA_BASE } from './apiConfig';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BRAND = (globalStyles?.primaryColor?.color) || '#3b82f6'; // fallback if not defined
const DEVICE_IMG = require('./assets/Oxyfit.jpg');
const MAX_PPG_POINTS = 600;
const MAX_METRIC_POINTS = 120; // for small line charts in cards
const SESSION_GAP_MS = 4000;   // sustained searching → finalize session

const safeAvg = (arr) => (arr.length ? Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : null);
const safeMin = (arr) => (arr.length ? Math.min(...arr) : null);
const safeMax = (arr) => (arr.length ? Math.max(...arr) : null);

export default function Oxygen({ navigation }) {
  const [devices, setDevices] = useState([]);
  const [connected, setConnected] = useState(null);
  const [ready, setReady] = useState(false);

  const [spo2, setSpo2] = useState(null);
  const [pr, setPr] = useState(null);
  const [pi, setPi] = useState(null);
  const [battery, setBattery] = useState(null);
  const [status, setStatus] = useState('Idle');

  const ppgRef = useRef([]);

  // sparkline series for cards (UI only)
  const spo2SeriesRef = useRef([]);
  const prSeriesRef   = useRef([]);

  // Session accumulation
  const sessionRef = useRef({ startTs: null, endTs: null, spo2: [], pr: [], ppgCount: 0 });
  const nextCardId = useRef(1);
  const [sessionCards, setSessionCards] = useState([]);
  const searchingSinceRef = useRef(null);

  // Auto-reconnect
  const lastDeviceIdRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  // New state for tabs and refresh
  const [activeTab, setActiveTab] = useState('LIST');
  const [refreshing, setRefreshing] = useState(false);

  const API_BASE_URL = DEV_DATA_BASE;
const DEV_TYPE = 'spo2';

const storeDeviceData = async (deviceData) => {
  try {
    await axios.post(`${API_BASE_URL}/devices/data`, deviceData, {
      withCredentials: true,
      headers: {'Content-Type': 'application/json'}
    });
  } catch (error) {
    console.error('Error storing device data:', error);
  }
};

// ─────────────────────────────────────────────
// SQLite setup
// ─────────────────────────────────────────────
const db = SQLite.openDatabase(
  { name: 'oxygen_sessions.db', location: 'default' },
  () => console.log('✅ SQLite DB opened'),
  (err) => console.error('❌ SQLite error:', err)
);

const initDB = () => {
  db.transaction(tx => {
    tx.executeSql(
      `CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        startTs INTEGER,
        endTs INTEGER,
        avgSpO2 REAL,
        minSpO2 REAL,
        maxSpO2 REAL,
        avgPR REAL,
        minPR REAL,
        maxPR REAL,
        ppgCount INTEGER
      );`
    );
  });
};
useEffect(() => {
  initDB();
  // Load existing sessions on mount
  db.transaction(tx => {
    tx.executeSql(
      'SELECT * FROM sessions ORDER BY id DESC',
      [],
      (_, { rows }) => {
        const existing = [];
        for (let i = 0; i < rows.length; i++) existing.push(rows.item(i));
        setSessionCards(existing);
        nextCardId.current = existing.length + 1;
      }
    );
  });
}, []);


const finalizeSessionIfAny = () => {
  const s = sessionRef.current;
  const hasPayload = (s.spo2.length || s.pr.length || s.ppgCount);
  if (s.startTs && hasPayload) {
    const card = {
      id: nextCardId.current++,
      startTs: s.startTs,
      endTs: s.endTs || s.startTs,
      avgSpO2: safeAvg(s.spo2), minSpO2: safeMin(s.spo2), maxSpO2: safeMax(s.spo2),
      avgPR:   safeAvg(s.pr),   minPR:   safeMin(s.pr),   maxPR:   safeMax(s.pr),
      ppgCount: s.ppgCount,
    };
    setSessionCards((prev) => [card, ...prev]);

    // Save to local SQLite
db.transaction(tx => {
  tx.executeSql(
    `INSERT INTO sessions (startTs, endTs, avgSpO2, minSpO2, maxSpO2, avgPR, minPR, maxPR, ppgCount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      card.startTs,
      card.endTs,
      card.avgSpO2,
      card.minSpO2,
      card.maxSpO2,
      card.avgPR,
      card.minPR,
      card.maxPR,
      card.ppgCount
    ],
    () => console.log('✅ Session stored in SQLite'),
    (_, err) => console.error('❌ Insert error:', err)
  );
});


    // ✅ API INTEGRATION: Store session data to backend
    const deviceData = {
      devId: connected?.id || 'spo2_device_001',
      devType: DEV_TYPE,
      data: {
        spo2: card.avgSpO2,
        pulse: card.avgPR,
        pi: pi, // Current PI value
        timestamp: new Date(card.startTs).toISOString(),
        duration: card.endTs - card.startTs,
        minSpo2: card.minSpO2,
        maxSpo2: card.maxSpO2,
        minPulse: card.minPR,
        maxPulse: card.maxPR,
        deviceInfo: {
          name: connected?.name || 'Oxygen Monitor',
          batteryLevel: battery,
          type: 'viatom'
        }
      }
    };
    storeDeviceData(deviceData);
  }
  sessionRef.current = { startTs: null, endTs: null, spo2: [], pr: [], ppgCount: 0 };
  searchingSinceRef.current = null;
};

  useEffect(() => {
    const subs = [
      O2.addListener(O2.O2Events.Discovered, (d) => {
        setDevices((prev) => (prev.find((x)=>x.id===d.id)? prev : [...prev, d]));
      }),
      O2.addListener(O2.O2Events.Connected, (d) => {
        setConnected(d); setReady(false); setStatus('Connected — preparing…');
        if (d?.id) lastDeviceIdRef.current = d.id;
        sessionRef.current = { startTs: null, endTs: null, spo2: [], pr: [], ppgCount: 0 };
        searchingSinceRef.current = null;
        spo2SeriesRef.current = []; prSeriesRef.current = [];
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      }),
      O2.addListener(O2.O2Events.Disconnected, () => {
        finalizeSessionIfAny();
        setConnected(null); setReady(false); setStatus('Disconnected');
        setSpo2(null); setPr(null); setPi(null); setBattery(null);
        ppgRef.current = []; spo2SeriesRef.current = []; prSeriesRef.current = [];

        // auto-reconnect in 2 seconds
        if (lastDeviceIdRef.current) {
          try { O2.startScan(); } catch {}
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            O2.connect(lastDeviceIdRef.current);
          }, 2000);
        }
      }),
      O2.addListener(O2.O2Events.Ready, () => {
        setReady(true); setStatus('Ready — waiting for frames…');
      }),
      O2.addListener(O2.O2Events.Info, (info) => {
        if (typeof info?.battery === 'number') setBattery(info.battery);
      }),
      O2.addListener(O2.O2Events.RealTime, (p) => {
        if (p.type === 'O2_SEARCHING') {
          setStatus('Searching sensor contact…');
          const now = p.timestamp || Date.now();
          const s = sessionRef.current;
          const hasPayload = (s.spo2.length || s.pr.length || s.ppgCount);
          if (hasPayload) {
            if (!searchingSinceRef.current) searchingSinceRef.current = now;
            else if (now - searchingSinceRef.current >= SESSION_GAP_MS) finalizeSessionIfAny();
          }
          return;
        }

        // valid frames
        searchingSinceRef.current = null;
        setStatus('Measuring…');
        if (typeof p.spo2 === 'number') setSpo2(p.spo2);
        if (typeof p.pulseRate === 'number') setPr(p.pulseRate);
        if (typeof p.pi === 'number') setPi(p.pi / 10);
        if (typeof p.battery === 'number') setBattery(p.battery);

        const ts = p.timestamp || Date.now();
        if (!sessionRef.current.startTs) sessionRef.current.startTs = ts;
        sessionRef.current.endTs = ts;
        if (typeof p.spo2 === 'number') {
          sessionRef.current.spo2.push(p.spo2);
          const sArr = [...spo2SeriesRef.current, p.spo2]; spo2SeriesRef.current = sArr.slice(-MAX_METRIC_POINTS);
        }
        if (typeof p.pulseRate === 'number') {
          sessionRef.current.pr.push(p.pulseRate);
          const pArr = [...prSeriesRef.current, p.pulseRate]; prSeriesRef.current = pArr.slice(-MAX_METRIC_POINTS);
        }
      }),
      O2.addListener(O2.O2Events.PPG, (p) => {
        const samples = Array.isArray(p.samples) ? p.samples : [];
        if (samples.length) {
          const merged = [...ppgRef.current, ...samples.map((v) => Number(v) || 0)];
          ppgRef.current = merged.slice(-MAX_PPG_POINTS);
        }
        const ts = (p && p.timestamp) || Date.now();
        if (!sessionRef.current.startTs) sessionRef.current.startTs = ts;
        sessionRef.current.endTs = ts;
        sessionRef.current.ppgCount += samples.length || 0;
        searchingSinceRef.current = null;
      }),
      O2.addListener(O2.O2Events.Error, (e) => {
        setStatus(`Error: ${e?.error || 'Unknown'}`);
      }),
    ];

    O2.startScan();

    return () => {
      subs.forEach((s) => s.remove());
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      O2.disconnect(); O2.stopScan();
    };
  }, []);

  const connect = (id) => { if (id) lastDeviceIdRef.current = id; O2.connect(id); };

  // helpers to build sparkline SVGs
  const makeLine = (series, w, h) => {
    if (!series || series.length < 2) return { points: '', gridY: [] };
    const min = Math.min(...series), max = Math.max(...series), span = Math.max(1, max - min);
    const stepX = w / Math.max(1, series.length - 1);
    const pts = series.map((v,i)=>`${(i*stepX).toFixed(1)},${(h - ((v - min)/span)*h).toFixed(1)}`).join(' ');
    const gridY = [0.25, 0.5, 0.75].map(p => p*h);
    return { points: pts, gridY };
  };

  const ppgGraph = useMemo(() => {
    const w = 360, h = 100, data = ppgRef.current;
    if (data.length < 2) return { w, h, points: '', gridY: [] };
    const min = Math.min(...data), max = Math.max(...data), span = Math.max(1, max - min);
    const stepX = w / Math.max(1, data.length - 1);
    const points = data.map((v, i) =>
      `${(i * stepX).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`
    ).join(' ');
    const gridY = [0.25, 0.5, 0.75].map((p) => p * h);
    return { w, h, points, gridY };
  }, [ppgRef.current.length]);

  const oxyLine = useMemo(() => makeLine(spo2SeriesRef.current, 320, 80), [spo2SeriesRef.current.length]);
  const prLine  = useMemo(() => makeLine(prSeriesRef.current,   320, 80), [prSeriesRef.current.length]);

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.scanCard} onPress={() => connect(item.id)}>
      <Text style={styles.scanTitle}>{item.name || 'Unknown'}</Text>
      <Text style={styles.scanSub}>RSSI {String(item.rssi)} | {item.id}</Text>
      <Text style={[styles.scanCta, { color: BRAND }]}>Tap to connect</Text>
    </TouchableOpacity>
  );

  // Refresh function for pull-to-refresh
  const onRefresh = async () => {
    setRefreshing(true);
    // Reload sessions from database
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM sessions ORDER BY id DESC',
        [],
        (_, { rows }) => {
          const existing = [];
          for (let i = 0; i < rows.length; i++) existing.push(rows.item(i));
          setSessionCards(existing);
          setRefreshing(false);
        }
      );
    });
  };

  // Helper function to generate X labels for charts
  const generateXLabels = (data) => {
    if (!data || data.length === 0) return [];
    
    return data.map((item, index) => {
      const date = new Date(item.startTs);
      
      // For few data points, show time. For many, show date
      if (data.length <= 5) {
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: true 
        });
      } else {
        // Show abbreviated date
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric' 
        });
      }
    });
  };

  // Get display data sorted by timestamp (newest first)
  const getDisplayData = () => {
    return [...sessionCards].sort((a, b) => {
      const dateA = new Date(a.startTs);
      const dateB = new Date(b.startTs);
      return dateB - dateA;
    });
  };

  // Prepare chart data (oldest first for chronological charts)
  const displayData = getDisplayData();
  const chartData = [...sessionCards]
    .filter(item => item.avgSpO2 != null && item.avgPR != null && !isNaN(item.avgSpO2) && !isNaN(item.avgPR))
    .sort((a, b) => {
      const dateA = new Date(a.startTs);
      const dateB = new Date(b.startTs);
      return dateA - dateB;
    });
  const xLabels = generateXLabels(chartData);

  // Validate if we have enough data for charts
  const hasEnoughChartData = chartData.length >= 2;

  const renderContent = () => {
    if (!connected) {
      return (
        <>
          <Text style={styles.sectionTitle}>Nearby Devices</Text>
          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
          
          {/* Tab Container for Disconnected State */}
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

          {/* Content based on active tab */}
          {activeTab === 'LIST' ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  colors={[BRAND]}
                />
              }>
              {sessionCards.length > 0 && (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>
                    All Sessions ({sessionCards.length})
                  </Text>
                </View>
              )}

              {sessionCards.length === 0 ? (
                <View style={{padding: 20, alignItems: 'center'}}>
                  <Text style={{color: '#666'}}>No oxygen readings yet.</Text>
                </View>
              ) : (
                <>
                  {displayData.map(item => (
                    <SessionCard key={item.id} item={item} />
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
                    colors={[BRAND]}
                  />
                }>
                <View style={styles.graphHeader}>
                  <Text style={styles.graphTitle}>Oxygen Trends</Text>
                </View>

                <View style={styles.graphCard}>
                  <View style={styles.graphHeader}>
                    <View style={[styles.iconCircle, {backgroundColor: BRAND}]}>
                      <Text style={styles.iconText}>O₂</Text>
                    </View>
                    <Text style={styles.graphTitleBlue}>OXYGEN LEVEL</Text>
                    <View style={{flex: 1}} />
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.infoRow}>
                    <View style={{flex: 1}}>
                      <Text style={styles.smallMuted}>Latest</Text>
                      <Text style={styles.smallMuted}>
                        {displayData[0] ? new Date(displayData[0].startTs).toLocaleTimeString() : '—'}
                      </Text>
                      <Text style={styles.goalText}>
                        Your goal: 95% or higher
                      </Text>
                    </View>
                    <Text style={styles.bigReading}>
                      {displayData[0]
                        ? `${displayData[0].avgSpO2}`
                        : '—'}{' '}
                      <Text style={styles.percent}>%</Text>
                    </Text>
                  </View>

                  {hasEnoughChartData ? (
                    <OxygenChart
                      width={SCREEN_WIDTH - 20}
                      data={chartData}
                      xLabels={xLabels}
                    />
                  ) : (
                    <View style={styles.noChartData}>
                      <Text style={styles.noChartDataText}>
                        {chartData.length === 0 ? "No data" : "Need 2+ readings for chart"}
                      </Text>
                    </View>
                  )}
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
                      <Text style={styles.smallMuted}>Latest</Text>
                      <Text style={styles.smallMuted}>
                        {displayData[0] ? new Date(displayData[0].startTs).toLocaleTimeString() : '—'}
                      </Text>
                      <Text style={styles.goalText}>Your goal: 60-100 bpm</Text>
                    </View>
                    <Text style={styles.bigReadingRight}>
                      {displayData[0] ? `${displayData[0].avgPR}` : '—'}{' '}
                      <Text style={styles.bpm}>bpm</Text>
                    </Text>
                  </View>

                  {hasEnoughChartData ? (
                    <PulseChart
                      width={SCREEN_WIDTH - 20}
                      data={chartData}
                      xLabels={xLabels}
                    />
                  ) : (
                    <View style={styles.noChartData}>
                      <Text style={styles.noChartDataText}>
                        {chartData.length === 0 ? "No data" : "Need 2+ readings for chart"}
                      </Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          )}
        </>
      );
    } else {
      return (
        <View style={{ flex: 1 }}>
          {/* Device status row */}
          <View style={styles.deviceRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image
                  source={DEVICE_IMG}
                  style={[styles.deviceImage, { borderColor: BRAND }]}
                  resizeMode="contain"
                />

              <View>
                <Text style={styles.deviceName}>{connected?.name || 'Oxyfit'}</Text>
                <Text style={[styles.connectedText, { color: BRAND }]}>Connected</Text>
              </View>
            </View>
            <View style={[styles.batteryPill, { borderColor: '#E5E7EB' }]}>
              <Text style={styles.batteryText}>{battery != null ? `${battery}%` : '--'}</Text>
            </View>
          </View>

          {/* Oxygen Level and Pulse Rate cards in parallel */}
          <View style={styles.parallelCards}>
            {/* Oxygen Level card */}
            <View style={styles.smallCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Oxygen Level</Text>
              </View>
              <View style={styles.valueRow}>
                <Text style={[styles.bigValue, { color: BRAND }]}>{spo2 != null ? spo2 : '--'}</Text>
                <Text style={styles.bigUnit}>%</Text>
              </View>
              <View style={styles.piRow}>
                <Text style={[styles.piText, { borderColor: '#E5E7EB' }]}>PI: {pi != null ? `${pi.toFixed(1)}%` : '--'}</Text>
              </View>
            </View>

            {/* Pulse Rate card */}
            <View style={styles.smallCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Pulse Rate</Text>
              </View>
              <View style={styles.valueRow}>
                <Text style={[styles.bigValue, { color: BRAND }]}>{pr != null ? pr : '--'}</Text>
                <Text style={styles.bigUnit}>/min</Text>
              </View>
            </View>
          </View>

          {/* PPG graph */}
          <Text style={styles.sectionTitle}>PPG</Text>
          <View style={styles.graphCard}>
            <Svg width={ppgGraph.w} height={ppgGraph.h}>
              {ppgGraph.gridY.map((y, i) => (
                <Line key={i} x1="0" x2={ppgGraph.w} y1={y} y2={y} stroke="#E5E7EB" strokeWidth="1" />
              ))}
              {ppgGraph.points ? <Polyline points={ppgGraph.points} stroke={BRAND} strokeWidth="2" fill="none" /> : null}
            </Svg>
          </View>

          {/* Tab Container */}
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

          {/* Content based on active tab */}
          {activeTab === 'LIST' ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  colors={[BRAND]}
                />
              }>
              {sessionCards.length > 0 && (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>
                    All Sessions ({sessionCards.length})
                  </Text>
                </View>
              )}

              {sessionCards.length === 0 ? (
                <View style={{padding: 20, alignItems: 'center'}}>
                  <Text style={{color: '#666'}}>No oxygen readings yet.</Text>
                </View>
              ) : (
                <>
                  {displayData.map(item => (
                    <SessionCard key={item.id} item={item} />
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
                    colors={[BRAND]}
                  />
                }>
                <View style={styles.graphHeader}>
                  <Text style={styles.graphTitle}>Oxygen Trends</Text>
                </View>

                <View style={styles.graphCard}>
                  <View style={styles.graphHeader}>
                    <View style={[styles.iconCircle, {backgroundColor: BRAND}]}>
                      <Text style={styles.iconText}>O₂</Text>
                    </View>
                    <Text style={styles.graphTitleBlue}>OXYGEN LEVEL</Text>
                    <View style={{flex: 1}} />
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.infoRow}>
                    <View style={{flex: 1}}>
                      <Text style={styles.smallMuted}>Latest</Text>
                      <Text style={styles.smallMuted}>
                        {displayData[0] ? new Date(displayData[0].startTs).toLocaleTimeString() : '—'}
                      </Text>
                      <Text style={styles.goalText}>
                        Your goal: 95% or higher
                      </Text>
                    </View>
                    <Text style={styles.bigReading}>
                      {displayData[0]
                        ? `${displayData[0].avgSpO2}`
                        : '—'}{' '}
                      <Text style={styles.percent}>%</Text>
                    </Text>
                  </View>

                  {hasEnoughChartData ? (
                    <OxygenChart
                      width={SCREEN_WIDTH - 20}
                      data={chartData}
                      xLabels={xLabels}
                    />
                  ) : (
                    <View style={styles.noChartData}>
                      <Text style={styles.noChartDataText}>
                        {chartData.length === 0 ? "No data" : "Need 2+ readings for chart"}
                      </Text>
                    </View>
                  )}
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
                      <Text style={styles.smallMuted}>Latest</Text>
                      <Text style={styles.smallMuted}>
                        {displayData[0] ? new Date(displayData[0].startTs).toLocaleTimeString() : '—'}
                      </Text>
                      <Text style={styles.goalText}>Your goal: 60-100 bpm</Text>
                    </View>
                    <Text style={styles.bigReadingRight}>
                      {displayData[0] ? `${displayData[0].avgPR}` : '—'}{' '}
                      <Text style={styles.bpm}>bpm</Text>
                    </Text>
                  </View>

                  {hasEnoughChartData ? (
                    <PulseChart
                      width={SCREEN_WIDTH - 20}
                      data={chartData}
                      xLabels={xLabels}
                    />
                  ) : (
                    <View style={styles.noChartData}>
                      <Text style={styles.noChartDataText}>
                        {chartData.length === 0 ? "No data" : "Need 2+ readings for chart"}
                      </Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          )}
        </View>
      );
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: BRAND }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation?.goBack?.()}>
            <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Oxygen</Text>
        </View>
      </SafeAreaView>

      {/* Content below header */}
      {renderContent()}
    </View>
  );
}

// Fixed Oxygen Chart Component
function OxygenChart({width, data, xLabels}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const Y_MIN = 80;
  const Y_MAX = 100;
  const bracketLabels = [100, 95, 90, 85, 80];

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

  // FIX: Handle single data point case
  const xFor = i => {
    if (data.length === 1) return padding.left + chartW / 2;
    return padding.left + (chartW / (data.length - 1)) * i;
  };
  
  const yFor = val => {
    const normalized = Math.max(Y_MIN, Math.min(Y_MAX, val));
    return padding.top + chartH - ((normalized - Y_MIN) / (Y_MAX - Y_MIN)) * chartH;
  };

  // FIX: Filter out invalid data points
  const validData = data.filter(d => d.avgSpO2 != null && !isNaN(d.avgSpO2));
  
  if (validData.length < 2) {
    return (
      <Svg width={w} height={h}>
        <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />
        <SvgText
          x={w / 2}
          y={h / 2}
          fontSize="12"
          fill="#7a7a7a"
          textAnchor="middle">
          Not enough valid data points
        </SvgText>
      </Svg>
    );
  }

  const avgPoints = validData.map((d, i) => `${xFor(i)},${yFor(d.avgSpO2)}`).join(' ');
  const todayX = xFor(validData.length - 1);
  const todayY = yFor(validData[validData.length - 1].avgSpO2);

  return (
    <Svg width={w} height={h}>
      <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />

      {/* Horizontal grid lines */}
      {[0.25, 0.5, 0.75].map(p => (
        <Line
          key={`grid-${p}`}
          x1={padding.left}
          x2={padding.left + chartW}
          y1={padding.top + chartH * p}
          y2={padding.top + chartH * p}
          stroke="#e9ecef"
          strokeWidth="1"
        />
      ))}

      {/* Goal line at 95% */}
      <Line
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(95)}
        y2={yFor(95)}
        stroke="#7acb6a"
        strokeWidth="1.5"
        strokeDasharray="4,4"
      />

      {/* FIX: Only draw polyline if we have valid points */}
      {avgPoints.split(' ').length >= 2 && (
        <Polyline points={avgPoints} fill="none" stroke={BRAND} strokeWidth="2" />
      )}

      {/* Data points */}
      {validData.map((d, i) => (
        <Circle
          key={`oxy-dot-${i}`}
          cx={xFor(i)}
          cy={yFor(d.avgSpO2)}
          r="4"
          fill="#ffffff"
          stroke={BRAND}
          strokeWidth="2"
        />
      ))}

      {/* Right rail + marker */}
      <Line
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

      {/* Right-side tick labels */}
      {bracketLabels.map(val => (
        <React.Fragment key={`oxy-br-${val}`}>
          <Line
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

      {/* Vertical today cursor */}
      {validData.length > 1 && (
        <Line
          x1={todayX}
          x2={todayX}
          y1={padding.top}
          y2={padding.top + chartH}
          stroke="#9ec6dd"
          strokeWidth="2"
          strokeDasharray="3,3"
        />
      )}

      {/* X labels - only show for actual data points */}
      {validData.map((_, i) => {
        if (i < xLabels.length) {
          return (
            <SvgText
              key={`x-oxy-${i}`}
              x={xFor(i)}
              y={padding.top + chartH + 18}
              fontSize="10"
              fill="#7a7a7a"
              textAnchor="middle">
              {xLabels[i]}
            </SvgText>
          );
        }
        return null;
      })}
    </Svg>
  );
}

// Fixed Pulse Chart Component
function PulseChart({width, data, xLabels}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const Y_MIN = 50;
  const Y_MAX = 120;
  const bracketLabels = [120, 100, 80, 60, 50];

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

  // FIX: Handle single data point case
  const xFor = i => {
    if (data.length === 1) return padding.left + chartW / 2;
    return padding.left + (chartW / (data.length - 1)) * i;
  };
  
  const yFor = val => {
    const normalized = Math.max(Y_MIN, Math.min(Y_MAX, val));
    return padding.top + chartH - ((normalized - Y_MIN) / (Y_MAX - Y_MIN)) * chartH;
  };

  // FIX: Filter out invalid data points
  const validData = data.filter(d => d.avgPR != null && !isNaN(d.avgPR));
  
  if (validData.length < 2) {
    return (
      <Svg width={w} height={h}>
        <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />
        <SvgText
          x={w / 2}
          y={h / 2}
          fontSize="12"
          fill="#7a7a7a"
          textAnchor="middle">
          Not enough valid data points
        </SvgText>
      </Svg>
    );
  }

  const avgPoints = validData.map((d, i) => `${xFor(i)},${yFor(d.avgPR)}`).join(' ');
  const todayX = xFor(validData.length - 1);
  const todayY = yFor(validData[validData.length - 1].avgPR);

  return (
    <Svg width={w} height={h}>
      <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />

      {/* Horizontal grid lines */}
      {[0.25, 0.5, 0.75].map(p => (
        <Line
          key={`grid-pulse-${p}`}
          x1={padding.left}
          x2={padding.left + chartW}
          y1={padding.top + chartH * p}
          y2={padding.top + chartH * p}
          stroke="#e9ecef"
          strokeWidth="1"
        />
      ))}

      {/* Normal range lines */}
      <Line
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(100)}
        y2={yFor(100)}
        stroke="#ffa43b"
        strokeWidth="1.5"
      />
      <Line
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(60)}
        y2={yFor(60)}
        stroke="#7acb6a"
        strokeWidth="1.5"
      />

      {/* FIX: Only draw polyline if we have valid points */}
      {avgPoints.split(' ').length >= 2 && (
        <Polyline points={avgPoints} fill="none" stroke={BRAND} strokeWidth="2" />
      )}

      {/* Data points */}
      {validData.map((d, i) => (
        <Circle
          key={`pulse-dot-${i}`}
          cx={xFor(i)}
          cy={yFor(d.avgPR)}
          r="4"
          fill="#ffffff"
          stroke={BRAND}
          strokeWidth="2"
        />
      ))}

      {/* Right rail + marker */}
      <Line
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

      {/* Right-side tick labels */}
      {bracketLabels.map(val => (
        <React.Fragment key={`pulse-br-${val}`}>
          <Line
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

      {/* Vertical today cursor */}
      {validData.length > 1 && (
        <Line
          x1={todayX}
          x2={todayX}
          y1={padding.top}
          y2={padding.top + chartH}
          stroke="#9ec6dd"
          strokeWidth="2"
          strokeDasharray="3,3"
        />
      )}

      {/* X labels - only show for actual data points */}
      {validData.map((_, i) => {
        if (i < xLabels.length) {
          return (
            <SvgText
              key={`x-pulse-${i}`}
              x={xFor(i)}
              y={padding.top + chartH + 18}
              fontSize="10"
              fill="#7a7a7a"
              textAnchor="middle">
              {xLabels[i]}
            </SvgText>
          );
        }
        return null;
      })}
    </Svg>
  );
}

function SessionCard({ item }) {
  const durSec = Math.max(1, Math.round((item.endTs - item.startTs) / 1000));
  return (
    <View style={styles.sessionCard}>
      <Text style={styles.sessionTitle}>Session #{item.id}</Text>
      <Text style={styles.sessionSub}>
        {new Date(item.startTs).toLocaleString()} → {new Date(item.endTs).toLocaleString()}  ({durSec}s)
      </Text>
      <View style={{ height: 8 }} />
      <View style={styles.rowWrap}>
        <Text style={[styles.badge, { color: BRAND }]}>Avg SpO₂: <Text style={styles.badgeVal}>{item.avgSpO2 ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Min SpO₂: <Text style={styles.badgeVal}>{item.minSpO2 ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Max SpO₂: <Text style={styles.badgeVal}>{item.maxSpO2 ?? '—'}</Text></Text>
      </View>
      <View style={[styles.rowWrap, { marginTop: 4 }]}>
        <Text style={[styles.badge, { color: BRAND }]}>Avg PR: <Text style={styles.badgeVal}>{item.avgPR ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Min PR: <Text style={styles.badgeVal}>{item.minPR ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Max PR: <Text style={styles.badgeVal}>{item.maxPR ?? '—'}</Text></Text>
      </View>
      <Text style={styles.sessionSub}>PPG samples: <Text style={styles.badgeVal}>{item.ppgCount}</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  
  // Header styles matching BloodPressure.js
  header: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.08,
    backgroundColor: BRAND,
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

  // Section title (black text)
  sectionTitle: { color: '#111827', fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 8, paddingHorizontal: 12 },

  // Scan list
  scanCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  scanTitle: { color: '#111827', fontSize: 16, fontWeight: '600' },
  scanSub: { color: '#6B7280', marginTop: 2, fontSize: 12 },
  scanCta: { marginTop: 6, fontSize: 12 },

  // Device row
  deviceRow: {
    backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB',
    padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  deviceImage: {
    width: 42,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    marginRight: 10,
  },
  deviceName: { color: '#111827', fontSize: 16, fontWeight: '700' },
  connectedText: { fontSize: 12, marginTop: 2 },
  batteryPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1 },
  batteryText: { color: '#374151', fontWeight: '700' },

  // Parallel cards container
  parallelCards: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 12,
    paddingHorizontal: 12
  },

  // Small cards for Oxygen Level and Pulse Rate
  smallCard: {
    backgroundColor: '#FFFFFF', 
    borderRadius: 16, 
    padding: 12, 
    borderWidth: 1, 
    borderColor: '#E5E7EB',
    width: '48%',
    alignItems: 'center'
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  cardTitle: { color: '#111827', fontSize: 16, fontWeight: '800', textAlign: 'center' },

  valueRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: 4, marginBottom: 6 },
  bigValue: { fontSize: 34, fontWeight: '900' },
  bigUnit: { color: '#6B7280', fontSize: 18, marginLeft: 4, marginBottom: 2 },

  // PI row
  piRow: { marginTop: 4 },
  piText: { color: '#374151', backgroundColor: '#FFFFFF', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontSize: 12 },

  // PPG card
  graphCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', marginHorizontal: 12, marginBottom: 12 },

  // Tab Container (from BloodPressure.js)
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    backgroundColor: BRAND,
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

  // Scroll views
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
  },
  graphScrollContent: {
    padding: 10,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: '#f8f9fa',
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: BRAND,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },

  // Graph styles (from BloodPressure.js)
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
    color: '#fff',
  },
  graphTitleBlue: {
    color: '#2c80ff',
    fontWeight: 'bold',
    fontSize: 16,
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
    paddingHorizontal: 15,
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
  percent: {
    fontSize: 14,
    fontWeight: 'normal',
    color: '#666',
  },
  bpm: {
    fontSize: 14,
    fontWeight: 'normal',
    color: '#666',
  },
  noChartData: {
    height: SCREEN_HEIGHT * 0.22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noChartDataText: {
    color: '#7a7a7a',
    fontSize: 12,
  },

  // Session cards
  sessionCard: { 
    marginTop: 12, 
    borderRadius: 12, 
    padding: 12, 
    backgroundColor: '#FFFFFF', 
    borderWidth: 1, 
    borderColor: '#E5E7EB',
    marginHorizontal: 12
  },
  sessionTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  sessionSub: { color: '#6B7280', marginTop: 4 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  badge: { marginRight: 12 },
  badgeVal: { color: '#111827' },
});