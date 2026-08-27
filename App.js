// App.jsx
import { enableScreens } from 'react-native-screens';
enableScreens();

import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import Login from './Login';
import Home from './Home';
import BloodPressure from './BloodPressure';
import ECG from './ECG';
import Connection from './Connection';
import Settings  from './Settings';
import Profile from './Profile';
import PrivacySecurity from './PrivacySecurityScreen';
import AboutApp from './AboutAppScreen';
import Oxygen from './Oxygen';
import PatientHome from './PatientHome';
import Readings from './Readings';
import Education from './Education';
import ArticleScreen from './ArticleScreen';
import { drainOutbox } from './outbox';

import { API_BASE } from './apiConfig';

export default function App() {
  const Stack = createStackNavigator();
  const refreshIntervalRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const isMounted = useRef(true);

  // Function to refresh auth token
  const refreshAuthToken = async () => {
    try {
      console.log('🔄 Refreshing auth token...');
      
      const refreshToken = await AsyncStorage.getItem('refreshToken');
      
      if (!refreshToken) {
        console.log('❌ No refresh token found');
        return false;
      }

      const response = await fetch(`${API_BASE}/api/auth/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        
        await AsyncStorage.setItem('token', data.accessToken);
        
        if (data.refreshToken) {
          await AsyncStorage.setItem('refreshToken', data.refreshToken);
        }

        console.log('✅ Token refreshed successfully');
        return true;
      } else {
        console.error('❌ Token refresh failed with status:', response.status);
        
        if (response.status === 401) {
          await AsyncStorage.multiRemove(['token', 'refreshToken']);
        }
        
        return false;
      }
    } catch (error) {
      console.error('🚨 Token refresh error:', error);
      return false;
    }
  };

  // Function to start token refresh scheduler (every 40 minutes)
  const startTokenRefreshScheduler = () => {
    // Clear any existing interval first
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    // Schedule token refresh every 40 minutes
    refreshIntervalRef.current = setInterval(async () => {
      if (!isMounted.current) return;
      
      const accessToken = await AsyncStorage.getItem('token');
      const refreshToken = await AsyncStorage.getItem('refreshToken');
      
      // Only refresh if we have both tokens
      if (accessToken && refreshToken) {
        console.log('⏰ 40 minutes passed - Refreshing token...');
        await refreshAuthToken();
      } else {
        console.log('⏸️ No tokens found');
        stopTokenRefreshScheduler();
      }
    }, 40 * 60 * 1000); // 40 minutes

    console.log('📅 Token refresh scheduler started');
  };

  // Function to stop token refresh scheduler
  const stopTokenRefreshScheduler = () => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  };

  // Function to check if we should start refresh
  const checkAndScheduleRefresh = async () => {
    const accessToken = await AsyncStorage.getItem('token');
    const refreshToken = await AsyncStorage.getItem('refreshToken');
    
    if (accessToken && refreshToken) {
      startTokenRefreshScheduler();
    } else {
      stopTokenRefreshScheduler();
    }
  };

  // Handle app state changes
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to foreground - check tokens
        checkAndScheduleRefresh();
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App went to background - stop refresh
        stopTokenRefreshScheduler();
      }
      
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  // Initial setup - check tokens on app start
  useEffect(() => {
    isMounted.current = true;
    checkAndScheduleRefresh();

    // Deliver any readings that survived a crash/relaunch in the durable outbox.
    // If not yet authenticated the POSTs 401 and the rows stay queued for a later
    // drain (BloodPressure focus), so this is safe to fire unconditionally.
    drainOutbox().catch(() => {});

    return () => {
      isMounted.current = false;
      stopTokenRefreshScheduler();
    };
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={Login} />
        <Stack.Screen name="Home" component={Home} />
        {/* New patient home (redesign). Registered but NOT yet the landing
            screen — to activate it, repoint Login's `navigation.replace('Home')`
            calls to 'PatientHome' (or swap this component onto the "Home" route).
            Left dormant so it does not ride the 1.0.50 release unreviewed. */}
        <Stack.Screen name="PatientHome" component={PatientHome} />
        <Stack.Screen name="Readings" component={Readings} />
        <Stack.Screen name="Education" component={Education} />
        <Stack.Screen name="Article" component={ArticleScreen} />
        <Stack.Screen name="BloodPressure" component={BloodPressure} />
        <Stack.Screen name="Oxygen" component={Oxygen} />
        <Stack.Screen name='ECG' component={ECG}/>
        <Stack.Screen name='Connection' component={Connection}/>
        <Stack.Screen name='Settings' component={Settings}/>
        <Stack.Screen name='Profile' component={Profile}/>
        <Stack.Screen name='PrivacySecurity' component={PrivacySecurity}/>
        <Stack.Screen name='AboutApp' component={AboutApp}/>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
// import { enableScreens } from 'react-native-screens';
// enableScreens();

// import 'react-native-gesture-handler';
// import React from 'react';
// import { NavigationContainer } from '@react-navigation/native';
// import { createStackNavigator } from '@react-navigation/stack';
// import { View, Text, StyleSheet } from 'react-native';
// import globalStyles from './globalStyles';
// import Login from './Login';
// import Home from './Home';
// import BloodPressure from './BloodPressure';
// import ECG from './ECG';
// import Connection from './Connection';
// import Settings  from './Settings';
// import Profile from './Profile';
// import PrivacySecurity from './PrivacySecurityScreen';
// import AboutApp from './AboutAppScreen';
// import Oxygen from './Oxygen';







// export default function App() {
//   const Stack = createStackNavigator();

//   return (
//     <NavigationContainer>
//       <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
//         <Stack.Screen name="Login" component={Login} />
//         <Stack.Screen name="Home" component={Home} />
//         <Stack.Screen name="BloodPressure" component={BloodPressure} />
//         <Stack.Screen name="Oxygen" component={Oxygen} />
//         <Stack.Screen name='ECG' component={ECG}/>
//         <Stack.Screen name='Connection' component={Connection}/>
//         <Stack.Screen name='Settings' component={Settings}/>
//         <Stack.Screen name='Profile' component={Profile}/>
//         <Stack.Screen name='PrivacySecurity' component={PrivacySecurity}/>
//         <Stack.Screen name='AboutApp' component={AboutApp}/>
        
//       </Stack.Navigator>
//     </NavigationContainer>
//   );
// }