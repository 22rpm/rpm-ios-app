import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, StyleSheet, TextInput, TouchableOpacity, Dimensions,
  KeyboardAvoidingView, Platform, ScrollView, Image, ActivityIndicator,
  Alert, Modal, ImageBackground, Animated
} from 'react-native';
import globalStyles from './globalStyles';
import CookieManager from '@react-native-cookies/cookies';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';
import {
  saveBiometricCredentials,
  getBiometricCredentials,
  getBiometricEmail,
  clearBiometricCredentials,
} from './biometricCredentials';
import { API_BASE } from './apiConfig';

const { width, height } = Dimensions.get('window');

export default function Login({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [hasBiometricCredentials, setHasBiometricCredentials] = useState(false);
  const [autoFaceIdAttempts, setAutoFaceIdAttempts] = useState(0);
  const [showManualLogin, setShowManualLogin] = useState(false);
  const [isAutoAuthenticating, setIsAutoAuthenticating] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Q1 lockout fix: advance the attempt count via a REF (the retry setTimeout
  // captured a stale `autoFaceIdAttempts=0`, so it never reached 2 -> infinite
  // Face-ID loop with no path to the password field). `manualEscapeRef` is a hard
  // stop: once the user opts for the password, no pending retry re-opens Face ID.
  const attemptsRef = useRef(0);
  const manualEscapeRef = useRef(false);

  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Check biometric availability
        const rnBiometrics = new ReactNativeBiometrics();
        const { available, biometryType } = await rnBiometrics.isSensorAvailable();
        
        if (available && (biometryType === 'FaceID' || biometryType === 'TouchID')) {
          setIsBiometricSupported(true);
          console.log(`Biometric type: ${biometryType}`);
        }

        // Check for stored credentials (Keychain, migrating any legacy copy).
        const creds = await getBiometricCredentials();

        if (creds) {
          setHasBiometricCredentials(true);
          setEmail(creds.email);
          
          // Auto trigger Face ID after a short delay
          setTimeout(() => {
            triggerAutoFaceId();
          }, 1500);
        } else {
          // No stored credentials, show manual login immediately
          setShowManualLogin(true);
          animateFormIn();
        }
      } catch (error) {
        console.error('Initialization error:', error);
        // On error, show manual login
        setShowManualLogin(true);
        animateFormIn();
      } finally {
        setIsInitialized(true);
      }
    };

    initializeApp();
  }, []);

  const animateFormIn = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Escape hatch: stop the Face-ID loop and show the password field. Independent
  // of the attempt counter, so the user is never stuck regardless of loop state.
  const goToManualLogin = () => {
    manualEscapeRef.current = true;
    setShowManualLogin(true);
    animateFormIn();
  };

  const triggerAutoFaceId = async () => {
    if (isAutoAuthenticating || manualEscapeRef.current || showManualLogin) return;

    setIsAutoAuthenticating(true);
    console.log(`Auto Face ID attempt ${attemptsRef.current + 1}`);

    try {
      const rnBiometrics = new ReactNativeBiometrics();

      const storedEmail = await getBiometricEmail();
      const promptMessage = 'Face ID for ' + (storedEmail || 'your account');

      const { success } = await rnBiometrics.simplePrompt({
        promptMessage: promptMessage,
        cancelButtonText: 'Use Password',
      });

      if (success) {
        await performAutoLogin();
      } else {
        // Non-success = the user reached the system prompt's "Use Password"
        // fallback (after iOS's own internal retries). Go STRAIGHT to the password
        // field — never re-show the system sheet on top of the app. That
        // re-showing was the trap: the app's Use-Password button sat behind an
        // ever-reappearing Face-ID sheet.
        goToManualLogin();
      }
    } catch (error) {
      console.error('Auto Face ID error:', error);
      handleFaceIdFailure();
    } finally {
      setIsAutoAuthenticating(false);
    }
  };

  // Only reached on a THROWN error (e.g. sensor failure), not on user cancel.
  // Uses attemptsRef so the count advances across the retry setTimeout (the old
  // code read a stale `autoFaceIdAttempts`, so it never reached 2).
  const handleFaceIdFailure = () => {
    attemptsRef.current += 1;
    setAutoFaceIdAttempts(attemptsRef.current); // keep the "Attempt X of 2" display in sync

    if (attemptsRef.current >= 2 || manualEscapeRef.current) {
      goToManualLogin();
    } else {
      setTimeout(() => {
        if (!manualEscapeRef.current && !showManualLogin) {
          triggerAutoFaceId();
        }
      }, 1500);
    }
  };

  const performAutoLogin = async () => {
    try {
      const creds = await getBiometricCredentials();
      const storedEmail = creds ? creds.email : null;
      const storedPassword = creds ? creds.password : null;

      if (storedEmail && storedPassword) {
        setIsLoading(true);
        
        // Determine login method based on stored identifier
        const method = storedEmail.includes('@') ? 'email' : 'username';
        
        const response = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            identifier: storedEmail,
            password: storedPassword,
            method: method,
            login_method: 'biometric'
          }),
        });

        const text = await response.text();
        console.log("Auto login response:", text);

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse JSON:', e);
          setShowManualLogin(true);
          animateFormIn();
          return;
        }

        if (response.ok && data.requiresOtp) {
          setShowOtpModal(true);
        } else if (response.ok && data.token) {
          const cookies = await CookieManager.get(API_BASE);
          const accessToken = cookies?.token?.value;
          const refreshToken = cookies?.refresh_token?.value;
          
          if (accessToken && refreshToken) {
            await AsyncStorage.setItem('token', accessToken);
            await AsyncStorage.setItem('refreshToken', refreshToken);
          }
          
          navigation.replace('Home');
        } else {
          // Login failed, show manual form
          setShowManualLogin(true);
          animateFormIn();
        }
      } else {
        // No stored credentials, show manual form
        setShowManualLogin(true);
        animateFormIn();
      }
    } catch (error) {
      console.error('Auto login error:', error);
      setShowManualLogin(true);
      animateFormIn();
    } finally {
      setIsLoading(false);
    }
  };

  const storeCredentialsForBiometric = async (userEmail, userPassword) => {
    try {
      await saveBiometricCredentials(userEmail, userPassword);
      setHasBiometricCredentials(true);
    } catch (error) {
      console.error('Error storing credentials:', error);
    }
  };

  const removeStoredCredentials = async () => {
    try {
      await clearBiometricCredentials();
      setHasBiometricCredentials(false);
      Alert.alert('Success', 'Face ID login has been removed.');
    } catch (error) {
      console.error('Error removing credentials:', error);
    }
  };

  const handleManualFaceId = async () => {
    try {
      setIsLoading(true);
      const rnBiometrics = new ReactNativeBiometrics();
      const storedEmail = await getBiometricEmail();
      const { success } = await rnBiometrics.simplePrompt({
        promptMessage: 'Face ID for ' + (storedEmail || 'your account'),
        cancelButtonText: 'Cancel',
      });

      if (success) {
        await performAutoLogin();
      }
    } catch (error) {
      console.error('Manual Face ID error:', error);
      Alert.alert('Error', 'Face ID authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const performLogin = async (userIdentifier, userPassword) => {
  setIsLoading(true);
  setError('');

  // Clear any previous network state
  let response = null;
  let text = null;

  try {
    // Determine if identifier is email or username
    const method = userIdentifier.includes('@') ? 'email' : 'username';

    // Add timeout and retry logic
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
      response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          identifier: userIdentifier,
          password: userPassword,
          method: method,
        }),
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        throw new Error('Request timeout. Please check your internet connection.');
      } else if (fetchError.message.includes('Network request failed')) {
        throw new Error('Network error. Please check your internet connection and try again.');
      } else {
        throw fetchError;
      }
    }
    
    clearTimeout(timeoutId);

    // Check if we got a response at all
    if (!response) {
      throw new Error('No response from server. Please check your connection.');
    }

    // Log response status for debugging
    console.log(`Response status: ${response.status}`);
    console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));

    text = await response.text();
    console.log("Raw login response:", text.substring(0, 500)); // Limit log size

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse JSON:', e);
      console.error('Raw text that failed to parse:', text);
      
      // Check if it's an HTML page (server error page)
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error('Server returned an error page. Please try again later.');
      }
      
      throw new Error('Server returned invalid response. Please try again.');
    }

    if (response.ok && data.requiresOtp) {
      console.log('OTP flow started');
      setShowOtpModal(true);
    } else if (response.ok && data.token) {
      console.log('Login successful, saving tokens');
      
      // Try to get cookies with error handling
      try {
        const cookies = await CookieManager.get(API_BASE);
        console.log('Cookies retrieved:', cookies ? 'Yes' : 'No');
        
        const accessToken = cookies?.token?.value || data.token;
        const refreshToken = cookies?.refresh_token?.value || data.refreshToken;
        
        if (accessToken) {
          await AsyncStorage.setItem('token', accessToken);
          console.log('Token saved to AsyncStorage');
        }
        
        if (refreshToken) {
          await AsyncStorage.setItem('refreshToken', refreshToken);
          console.log('Refresh token saved to AsyncStorage');
        }
      } catch (cookieError) {
        console.error('Cookie error:', cookieError);
        // Still proceed with login if we have the token from response
        if (data.token) {
          await AsyncStorage.setItem('token', data.token);
        }
      }
      
      // Ask user if they want to enable Face ID for future logins
      if (isBiometricSupported && !hasBiometricCredentials) {
        Alert.alert(
          'Enable Face ID?',
          'Do you want to enable Face ID for faster login in the future?',
          [
            {
              text: 'Not Now',
              style: 'cancel',
              onPress: () => navigation.replace('Home')
            },
            {
              text: 'Enable',
              onPress: async () => {
                await storeCredentialsForBiometric(userIdentifier, userPassword);
                navigation.replace('Home');
              }
            }
          ]
        );
      } else {
        navigation.replace('Home');
      }
    } else {
      // Handle different error scenarios
      if (response.status === 401) {
        setError(data.message || 'Invalid credentials. Please check your email/username and password.');
      } else if (response.status === 500) {
        setError('Server error. Please try again later.');
      } else if (response.status === 404) {
        setError('Service not available. Please try again later.');
      } else {
        setError(data.message || 'Login failed. Please try again.');
      }
      
      // Log the error for debugging
      console.error('Login failed:', {
        status: response.status,
        statusText: response.statusText,
        data: data
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    
    // More specific error messages
    if (error.message.includes('timeout')) {
      setError('Request timeout. Please check your internet connection and try again.');
    } else if (error.message.includes('Network error')) {
      setError('Network error. Please check your internet connection and try again.');
    } else if (error.message.includes('Failed to fetch')) {
      setError('Cannot connect to server. Please check your internet connection.');
    } else if (error.message.includes('SSL')) {
      setError('Secure connection failed. Please check your date/time settings.');
    } else {
      setError(error.message || 'An unexpected error occurred. Please try again.');
    }
  } finally {
    setIsLoading(false);
  }
};

  // const performLogin = async (userIdentifier, userPassword) => {
  //   setIsLoading(true);
  //   setError('');

  //   try {
  //     // Determine if identifier is email or username
  //     const method = userIdentifier.includes('@') ? 'email' : 'username';

  //     const response = await fetch(`${API_BASE}/api/auth/login`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       credentials: 'include',
  //       body: JSON.stringify({
  //         identifier: userIdentifier,
  //         password: userPassword,
  //         method: method,
  //       }),
  //     });

  //     const text = await response.text();
  //     console.log("Raw login response:", text);

  //     let data;
  //     try {
  //       data = JSON.parse(text);
  //     } catch (e) {
  //       console.error('Failed to parse JSON:', e);
  //       setError('Server returned invalid response');
  //       return;
  //     }

  //     if (response.ok && data.requiresOtp) {
  //       console.log('OTP flow started');
  //       setShowOtpModal(true);
  //     } else if (response.ok && data.token) {
  //       console.log('Login successful, saving tokens');
  //       const cookies = await CookieManager.get(API_BASE);
  //       const accessToken = cookies?.token?.value;
  //       const refreshToken = cookies?.refresh_token?.value;
        
  //       if (accessToken && refreshToken) {
  //         await AsyncStorage.setItem('token', accessToken);
  //         await AsyncStorage.setItem('refreshToken', refreshToken);
  //       }
        
  //       // Ask user if they want to enable Face ID for future logins
  //       if (isBiometricSupported && !hasBiometricCredentials) {
  //         Alert.alert(
  //           'Enable Face ID?',
  //           'Do you want to enable Face ID for faster login in the future?',
  //           [
  //             {
  //               text: 'Not Now',
  //               style: 'cancel',
  //               onPress: () => navigation.replace('Home')
  //             },
  //             {
  //               text: 'Enable',
  //               onPress: async () => {
  //                 await storeCredentialsForBiometric(userIdentifier, userPassword);
  //                 navigation.replace('Home');
  //               }
  //             }
  //           ]
  //         );
  //       } else {
  //         navigation.replace('Home');
  //       }
  //     } else {
  //       setError(data.message || 'Login failed. Please try again.');
  //     }
  //   } catch (error) {
  //     console.error('Login error:', error);
  //     setError('Network error. Please check your connection and try again.');
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill all fields');
      return;
    }

    // Only validate email format if identifier contains '@'
    if (email.includes('@')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        setError('Please enter a valid email address');
        return;
      }
    }

    await performLogin(email, password);
  };

  const handleOtpVerification = async () => {
    if (!otp || otp.length !== 6) {
      setError('Please enter a valid 6-digit OTP');
      return;
    }

    setIsVerifyingOtp(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          otp,
          device_fingerprint: 'unique-browser-hash'
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const cookies = await CookieManager.get(API_BASE);
        const accessToken = cookies?.token?.value;
        const refreshToken = cookies?.refresh_token?.value;

        if (accessToken && refreshToken) {
          await AsyncStorage.setItem('token', accessToken);
          await AsyncStorage.setItem('refreshToken', refreshToken);
        }

        // Ask user if they want to enable Face ID for future logins
        if (isBiometricSupported && !hasBiometricCredentials) {
          Alert.alert(
            'Enable Face ID?',
            'Do you want to enable Face ID for faster login in the future?',
            [
              {
                text: 'Not Now',
                style: 'cancel',
                onPress: () => navigation.replace('Home')
              },
              {
                text: 'Enable',
                onPress: async () => {
                  await storeCredentialsForBiometric(email, password);
                  navigation.replace('Home');
                }
              }
            ]
          );
        } else {
          navigation.replace('Home');
        }
      } else {
        setError(data.message || 'Invalid OTP. Please try again.');
      }
    } catch (error) {
      console.error('OTP verification error:', error);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Refresh auth token function
  const refreshAuthToken = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/refresh-token`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        console.log("Refresh failed, logging out");
        navigation.replace('Login');
        return;
      }

      console.log("Auth token refreshed successfully");
    } catch (error) {
      console.error("Token refresh error:", error);
      navigation.replace('Login');
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      refreshAuthToken();
    }, 14 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Background Image */}
        <View style={styles.backgroundWrapper}>
          <ImageBackground
            source={require('./assets/loginbk.png')}
            style={styles.backgroundImage}
            resizeMode="cover"
          >
            <View style={styles.backgroundOverlay} />
            <Image
              source={require('./assets/infuzamed_logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </ImageBackground>
        </View>

        {/* Show loading only when auto Face ID is in progress */}
        {!showManualLogin && hasBiometricCredentials && isBiometricSupported && (
          <View style={styles.autoFaceIdContainer}>
            <ActivityIndicator size="large" color={globalStyles.primaryColor.color} />
            <Text style={styles.autoFaceIdText}>
              Looking for Face ID...
            </Text>
            <Text style={styles.autoFaceIdSubText}>
              Attempt {Math.min(autoFaceIdAttempts + 1, 2)} of 2
            </Text>
            
            <TouchableOpacity
              style={styles.usePasswordButton}
              onPress={goToManualLogin}
            >
              <Text style={styles.usePasswordText}>Use Password Instead</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Show manual login form when:
            - No Face ID credentials stored
            - Face ID failed twice  
            - User tapped "Use Password Instead"
        */}
        {(showManualLogin || !hasBiometricCredentials || !isBiometricSupported) && (
          <Animated.View 
            style={[
              styles.formContainer,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }]
              }
            ]}
          >
            {/* Email/Username Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email or Username</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setError('');
                }}
                placeholder="Enter your email or username"
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            
            {/* Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setError('');
                }}
                placeholder="Enter your password"
                placeholderTextColor="#999"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Error Message */}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            
            {/* Login Button */}
            <TouchableOpacity 
              style={[styles.button, isLoading && styles.buttonDisabled]} 
              onPress={handleLogin}
              activeOpacity={0.8}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Login</Text>
              )}
            </TouchableOpacity>

            {/* Face ID Button (Manual Trigger) - Only show if we have stored credentials */}
            {isBiometricSupported && hasBiometricCredentials && (
              <TouchableOpacity 
                style={styles.biometricButton}
                onPress={handleManualFaceId}
                activeOpacity={0.8}
                disabled={isLoading}
              >
                <Text style={styles.biometricButtonText}>
                  Login with Face ID
                </Text>
              </TouchableOpacity>
            )}

            {/* Remove Biometric Data Option */}
            {hasBiometricCredentials && (
              <TouchableOpacity 
                style={styles.removeBiometricButton}
                onPress={removeStoredCredentials}
              >
                <Text style={styles.removeBiometricText}>
                  Remove Saved Face ID
                </Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* Footer - Always show at bottom */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Developed By</Text>
          <Text style={[styles.footerText, styles.footerCompany]}>
            Revive Medical Technologies Inc.
          </Text>
        </View>
      </ScrollView>

      {/* OTP Verification Modal */}
      <Modal
        visible={showOtpModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowOtpModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>OTP Verification</Text>
            <Text style={styles.modalSubtitle}>
              Please enter the 6-digit OTP sent to your email
            </Text>
            
            <TextInput
              style={styles.otpInput}
              value={otp}
              onChangeText={(text) => {
                setOtp(text);
                setError('');
              }}
              placeholder="Enter OTP"
              placeholderTextColor="#999"
              keyboardType="numeric"
              maxLength={6}
            />
            
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowOtpModal(false);
                  setOtp('');
                  setError('');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.verifyButton, isVerifyingOtp && styles.buttonDisabled]}
                onPress={handleOtpVerification}
                disabled={isVerifyingOtp}
              >
                {isVerifyingOtp ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.verifyButtonText}>Verify</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  backgroundWrapper: {
    width: '100%',
    height: '40%',
    borderBottomLeftRadius: '10%',
    borderBottomRightRadius: '10%',
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  backgroundImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderBottomLeftRadius: '10%',
    borderBottomRightRadius: '10%',
  },
  logo: {
    width: 350,
    height: 300,
    zIndex: 1,
  },
  autoFaceIdContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: width * 0.1,
    minHeight: height * 0.3,
  },
  autoFaceIdText: {
    fontSize: width * 0.045,
    fontWeight: 'bold',
    color: '#2f2f2f',
    marginTop: height * 0.03,
    textAlign: 'center',
  },
  autoFaceIdSubText: {
    fontSize: width * 0.035,
    color: '#666',
    marginTop: height * 0.01,
    textAlign: 'center',
  },
  usePasswordButton: {
    marginTop: height * 0.04,
    padding: 15,
  },
  usePasswordText: {
    color: globalStyles.primaryColor.color,
    fontSize: width * 0.04,
    fontWeight: '500',
  },
  formContainer: {
    paddingHorizontal: width * 0.1,
    marginTop: height * 0.03,
    flex: 1,
  },
  inputGroup: {
    marginBottom: height * 0.02,
  },
  label: {
    fontSize: width * 0.045,
    fontWeight: 'bold',
    color: '#2f2f2f',
    marginBottom: height * 0.01,
  },
  input: {
    width: '100%',
    fontSize: width * 0.04,
    padding: width * 0.04,
    borderRadius: 12,
    backgroundColor: '#ebf2f9',
    color: '#333',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  errorText: {
    color: '#e74c3c',
    fontSize: width * 0.035,
    marginTop: height * 0.01,
    textAlign: 'center',
    fontWeight: '500',
  },
  button: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingVertical: height * 0.02,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: height * 0.04,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  biometricButton: {
    backgroundColor: '#007AFF',
    paddingVertical: height * 0.02,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: height * 0.02,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  removeBiometricButton: {
    paddingVertical: height * 0.015,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: height * 0.01,
  },
  removeBiometricText: {
    color: '#666',
    fontSize: width * 0.035,
    textDecorationLine: 'underline',
  },
  buttonDisabled: {
    backgroundColor: '#a0a0a0',
    opacity: 0.7,
  },
  buttonText: {
    color: 'white',
    fontSize: width * 0.045,
    fontWeight: 'bold',
  },
  biometricButtonText: {
    color: 'white',
    fontSize: width * 0.04,
    fontWeight: 'bold',
  },
  footer: {
    paddingBottom: height * 0.03,
    alignItems: 'center',
    width: '100%',
    marginTop: height * 0.05,
  },
  footerText: {
    fontSize: width * 0.035,
    color: '#a1a1a1',
  },
  footerCompany: {
    fontWeight: '600',
    fontSize: width * 0.04,
    marginTop: height * 0.005,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 20,
  },
  modalContent: {
    width: '90%',
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: width * 0.05,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#2f2f2f',
  },
  modalSubtitle: {
    fontSize: width * 0.035,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
  },
  otpInput: {
    width: '80%',
    fontSize: width * 0.05,
    padding: 15,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    textAlign: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: '#f1f1f1',
  },
  verifyButton: {
    backgroundColor: globalStyles.primaryColor.color,
  },
  cancelButtonText: {
    color: '#666',
    fontWeight: 'bold',
  },
  verifyButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});