import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  StatusBar,
  Alert,
  ActivityIndicator,
  Platform
} from 'react-native';
import globalStyles from './globalStyles';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE } from './apiConfig';

const { width, height } = Dimensions.get('window');

// Responsive size calculator
const responsiveSize = (size) => {
  const scale = width / 375; // 375 is standard iPhone width
  return Math.round(size * Math.min(scale, 2));
};

export default function Profile({ navigation }) {
  const [isLoading, setIsLoading] = useState(true);
  const [userData, setUserData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
  });

  // Fetch user data from API
  const fetchUserData = async () => {
    try {
      setIsLoading(true);
      console.log('🔄 Starting to fetch user data from API...');
      
      const token = await AsyncStorage.getItem('token');
      console.log('🔑 Token retrieved from storage:', token ? 'Yes' : 'No');
      
      if (!token) {
        console.log('❌ No token found, user might not be logged in');
        Alert.alert('Error', 'Please login again');
        navigation.navigate('Login');
        return;
      }

      const response = await fetch(`${API_BASE}/api/auth/check-me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      console.log('📡 API Response Status:', response.status);

      const responseText = await response.text();
      console.log('📡 API Raw Response:', responseText);

      let data;
      try {
        data = JSON.parse(responseText);
        console.log('✅ Successfully parsed JSON response:', JSON.stringify(data, null, 2));
      } catch (parseError) {
        console.error('❌ Failed to parse JSON response:', parseError);
        console.error('Raw response that failed to parse:', responseText);
        throw new Error('Invalid JSON response from server');
      }

      // Check for the correct response structure
      if (response.ok && data.ok) {
        console.log('✅ API call successful, user data:', data.user);
        
        // Map API response to local state
        const user = data.user;
        
        // Split the name into first and last name
        const nameParts = user.name ? user.name.split(' ') : ['', ''];
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        setUserData({
          firstName: firstName,
          lastName: lastName,
          email: user.email || '',
          phone: user.phoneNumber || '',
          dateOfBirth: user.dateOfBirth || '',
          gender: user.gender || '',
        });
        
        console.log('✅ User data successfully updated in state');
      } else {
        console.error('❌ API returned error:', data.message || 'Unknown error');
        Alert.alert('Error', data.message || 'Failed to fetch user data');
      }
    } catch (error) {
      console.error('❌ Error fetching user data:', error);
      Alert.alert(
        'Network Error', 
        'Failed to load profile data. Please check your connection and try again.'
      );
    } finally {
      setIsLoading(false);
      console.log('🏁 Finished loading user data, isLoading set to false');
    }
  };

  useEffect(() => {
    console.log('🎯 Profile component mounted, fetching user data...');
    fetchUserData();
  }, []);

  const handleBack = () => {
    navigation.goBack();
  };

  const renderInfoField = (label, value) => (
    <View style={styles.infoField}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Not set'}</Text>
    </View>
  );

  // Show loading indicator while fetching data
  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar backgroundColor={globalStyles.primaryColor.color} barStyle="light-content" />
        <SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBack}>
              <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Profile</Text>
            <View style={styles.headerPlaceholder} />
          </View>
        </SafeAreaView>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={globalStyles.primaryColor.color} />
          <Text style={styles.loadingText}>Loading profile data...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={globalStyles.primaryColor.color} barStyle="light-content" />
      
      {/* Header - Fixed to match Settings header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack}>
            <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.headerPlaceholder} />
        </View>
      </SafeAreaView>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <Image 
              source={require('./assets/avatar.png')} 
              style={styles.avatar} 
            />
          </View>
          <Text style={styles.userName}>
            {userData.firstName} {userData.lastName}
          </Text>
          <Text style={styles.userEmail}>{userData.email}</Text>
          <Text style={styles.userRole}>Role: Patient</Text>
        </View>

        {/* Personal Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <View style={styles.sectionContent}>
            {renderInfoField('First Name', userData.firstName)}
            {renderInfoField('Last Name', userData.lastName)}
            {renderInfoField('Email', userData.email)}
            {renderInfoField('Phone', userData.phone)}
            {renderInfoField('Date of Birth', userData.dateOfBirth)}
            {renderInfoField('Gender', userData.gender)}
          </View>
        </View>

        {/* App Version */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>22 Remote Patient Monitoring Services</Text>
          <Text style={styles.versionNumber}>Version 1.0 (Build 2101)</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa'
  },
  header: {
    width: '100%',
    height: height * 0.08,
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
  headerPlaceholder: {
    width: width * 0.06
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: responsiveSize(20),
    flexGrow: 1,
  },
  profileHeader: {
    alignItems: 'center',
    padding: responsiveSize(20),
    backgroundColor: '#fff',
    margin: responsiveSize(15),
    borderRadius: responsiveSize(16),
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  avatarContainer: {
    marginBottom: responsiveSize(15),
  },
  avatar: {
    width: responsiveSize(100),
    height: responsiveSize(100),
    borderRadius: responsiveSize(50),
    borderWidth: responsiveSize(3),
    borderColor: globalStyles.primaryColor.color,
    minWidth: 80,
    minHeight: 80,
  },
  userName: {
    fontSize: responsiveSize(20),
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: responsiveSize(5),
    textAlign: 'center',
    minFontSize: 18,
  },
  userEmail: {
    fontSize: responsiveSize(16),
    color: '#7f8c8d',
    marginBottom: responsiveSize(3),
    textAlign: 'center',
    minFontSize: 14,
  },
  userId: {
    fontSize: responsiveSize(14),
    color: '#bdc3c7',
    marginBottom: responsiveSize(2),
    textAlign: 'center',
    minFontSize: 12,
  },
  userRole: {
    fontSize: responsiveSize(14),
    color: '#bdc3c7',
    fontStyle: 'italic',
    textAlign: 'center',
    minFontSize: 12,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: responsiveSize(15),
    marginBottom: responsiveSize(20),
    borderRadius: responsiveSize(16),
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: responsiveSize(18),
    fontWeight: 'bold',
    color: '#2c3e50',
    padding: responsiveSize(16),
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#ecf0f1',
    minFontSize: 16,
  },
  sectionContent: {
    padding: responsiveSize(16),
  },
  infoField: {
    marginBottom: responsiveSize(15),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  infoLabel: {
    fontSize: responsiveSize(16),
    color: '#7f8c8d',
    fontWeight: '500',
    flex: 1,
    minFontSize: 14,
  },
  infoValue: {
    fontSize: responsiveSize(16),
    color: '#2c3e50',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
    minFontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: responsiveSize(20),
  },
  loadingText: {
    marginTop: responsiveSize(20),
    fontSize: responsiveSize(16),
    color: '#7f8c8d',
    textAlign: 'center',
    minFontSize: 14,
  },
  versionContainer: {
    alignItems: 'center',
    marginTop: responsiveSize(20),
    marginBottom: responsiveSize(10),
    paddingHorizontal: responsiveSize(15),
  },
  versionText: {
    fontSize: responsiveSize(14),
    color: '#7f8c8d',
    marginBottom: responsiveSize(4),
    textAlign: 'center',
    minFontSize: 12,
  },
  versionNumber: {
    fontSize: responsiveSize(12),
    color: '#bdc3c7',
    textAlign: 'center',
    minFontSize: 10,
  },
});