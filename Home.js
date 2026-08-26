import React, { useState, useRef, useEffect } from 'react'; 
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Image, 
  ScrollView, 
  Dimensions,
  Modal,
  TouchableWithoutFeedback,
  SafeAreaView
} from 'react-native';
import globalStyles from './globalStyles';
import { LineChart } from "react-native-chart-kit";
import CookieManager from '@react-native-cookies/cookies';
import axios from 'axios';
import { API_BASE, DEV_DATA_BASE as API_BASE_URL } from './apiConfig';

const { width, height } = Dimensions.get('window');

const cardBackground = '#efefef';
const iconBackground = 'transparent';

// Configure axios to include credentials (cookies)
axios.defaults.withCredentials = true;
// API_BASE_URL is imported from apiConfig (DEV_DATA_BASE) — single source of truth.

// Health grid cards
const healthCards = [
  { id: 1, image: require('./assets/BP.png'), text: 'Blood Pressure', navigation: 'BloodPressure' },
  { id: 2, image: require('./assets/OS.png'), text: 'Oxygen Saturation', navigation: 'Oxygen' },
  { id: 6, image: require('./assets/ECG.png'), text: 'ECG', navigation: 'ECG' },
  { id: 3, image: require('./assets/BG.png'), text: 'Blood Glucose', disabled: true },
  { id: 5, image: require('./assets/T.png'), text: 'Temperature', disabled: true },
  { id: 7, image: require('./assets/W.png'), text: 'Weight', disabled: true },
];

// Summary cards data - BP will be updated dynamically
const summaryCards = [
  { id: 'bp', title: 'Blood Pressure', value: '--/--', unit: 'mmHg', subText: 'Pulse Rate: -- bpm', goal: '120/80' },
  { id: 'weight', title: 'Weight', value: '190.2', unit: 'lbs', subText: 'BMI: 27.3', goal: '188.0' },
  { id: 'glucose', title: 'Blood Glucose', value: '98', unit: 'mg/dL', subText: 'Fasting', goal: '100' },
  { id: 'temperature', title: 'Temperature', value: '98.6', unit: '°F', subText: 'Normal', goal: '98.6' },
  { id: 'SpO2', title: 'SpO2', value: '97', unit: '%', subText: 'Normal', goal: '95-100' },
  { id: 'ECG', title: 'ECG', value: '--', unit: '', subText: 'Normal', goal: '--' },
];
const allowedSelectable = ['bp', 'SpO2', 'ECG'];

// Menu options data
const menuOptions = [
  { id: 'profile', text: 'Profile', navigation: 'Profile' },
  { id: 'connection', text: 'Chat', navigation: 'Connection'},
  { id: 'settings', text: 'Setting', navigation: 'Settings' },
  { id: 'logout', text: 'Logout', navigation: 'Login' }
];

export default function Home({ navigation }) {
  const [selectedCards, setSelectedCards] = useState(['bp']);
  const [showModal, setShowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [userData, setUserData] = useState({ name: '' }); // ADD THIS LINE
  const [bpData, setBpData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const menuRef = useRef(null);
  const scrollViewRef = useRef(null);


    // Function to fetch user data
  const fetchUserData = async () => {
    try {
      console.log('Fetching user data...');
      const response = await fetch(`${API_BASE}/api/auth/check-me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });

      const responseText = await response.text();
      console.log('User API Raw Response:', responseText);

      let data;
      try {
        data = JSON.parse(responseText);
        console.log('✅ User data parsed successfully:', data);
      } catch (parseError) {
        console.error('❌ Failed to parse user data JSON:', parseError);
        return;
      }

      if (response.ok && data.ok && data.user) {
        console.log('✅ User data loaded:', data.user);
        setUserData({
          name: data.user.name || '',
        });
      } else {
        console.log('No user data found');
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  // Function to fetch latest BP data
  const fetchLatestBPData = async () => {
    try {
      console.log('📥 Fetching latest BP data...');
      const response = await axios.get(
        `${API_BASE_URL}/devices/data/latest?deviceType=bp`,
        {
          withCredentials: true,
        }
      );
      
      if (response.data.success && response.data.data) {
        console.log('✅ Latest BP data loaded:', response.data.data);
        setBpData(response.data.data);
      } else {
        console.log('ℹ️ No BP data found');
        setBpData(null);
      }
    } 
catch (error) {
  console.error('❌ Error fetching latest BP data:', {
    message: error.message,
    code: error.code,
    response: error.response?.status,
    data: error.response?.data,
  });

  // Show alert for user
  Alert.alert(
    'Data Fetch Failed',
    error.response
      ? `Server returned ${error.response.status}: ${error.response.data?.message || 'Unexpected error'}`
      : `Could not connect to server. Please check your internet connection or login session.`,
    [{ text: 'OK', style: 'default' }],
    { cancelable: true }
  );

  setBpData(null);
}
    finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Fetch latest BP data when component mounts
    fetchLatestBPData();
    fetchUserData(); // ADD THIS LINE
  }, []);

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'GET',
        credentials: 'include',
      });
      await CookieManager.clearAll();
      navigation.replace('Login');
    } catch (error) {
      console.error("Logout error:", error);
      navigation.replace('Login');
    }
  };

  const handleMenuOptionPress = (option) => {
    setShowMenu(false);
    if (option.id === 'logout') {
      handleLogout();
    } else {
      navigation.navigate(option.navigation);
    }
  };

  const handleCardPress = (card) => {
    navigation.navigate(card.navigation);
  };

  const toggleSummaryCard = (id) => {
    if (selectedCards.includes(id)) {
      if (selectedCards.length > 1) {
        setSelectedCards(selectedCards.filter(c => c !== id));
      }
    } else {
      if (selectedCards.length < 3) {
        setSelectedCards([...selectedCards, id]);
      }
    }
  };

  // Get BP card data with real values
  const getBPCardData = () => {
    if (isLoading) {
      return {
        id: 'bp',
        title: 'Blood Pressure',
        value: 'Loading...',
        unit: '',
        subText: 'Fetching data...',
        goal: '120/80'
      };
    }

    if (!bpData) {
      return {
        id: 'bp',
        title: 'Blood Pressure',
        value: '--/--',
        unit: 'mmHg',
        subText: 'No data available',
        goal: '120/80'
      };
    }

    const bpValue = bpData.data;
    return {
      id: 'bp',
      title: 'Blood Pressure',
      value: `${bpValue.systolic || '--'}/${bpValue.diastolic || '--'}`,
      unit: 'mmHg',
      subText: `Pulse Rate: ${bpValue.pulse || '--'} bpm`,
      goal: '120/80',
      timestamp: bpData.createdAt
    };
  };

  // Get the actual card data for display
  const getCardData = (id) => {
    if (id === 'bp') {
      return getBPCardData();
    }
    return summaryCards.find(c => c.id === id);
  };

return (
  <SafeAreaView style={styles.safeArea}>
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.logoContainer}>
          <Image source={require('./assets/infuzamed_logo.png')} style={styles.logo} />
        </View>
        <View style={styles.menuContainer} ref={menuRef}>
          <TouchableOpacity 
            style={styles.menuButton}
            onPress={() => setShowMenu(!showMenu)}
          >
            <Text style={styles.menuDots}>⋮</Text>
          </TouchableOpacity>
          
          {showMenu && (
            <View style={styles.menuDropdown}>
              {menuOptions.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={styles.menuItem}
                  onPress={() => handleMenuOptionPress(option)}
                >
                  <Text style={styles.menuItemText}>{option.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Profile Row */}
        <View style={styles.profileRow}>
          <Image source={require('./assets/avatar.png')} style={styles.profileImage} />
          <View>
            <Text style={styles.welcomeText}>Welcome</Text>
            <Text style={styles.userName}>{userData.name || 'User'}</Text>
          </View>
        </View>

      {/* Main ScrollView Content */}
      <ScrollView 
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
        alwaysBounceVertical={true}
        nestedScrollEnabled={true}
      >
        {/* Row: Category (left) + Select Metrics (right) */}
        <View style={styles.metricsCategoryRow}>
          <Text style={styles.categoryText}>Category</Text>
          <TouchableOpacity 
            style={styles.floatingButton}
            onPress={() => setShowModal(true)}
          >
            <Text style={styles.floatingButtonText}>Select Metrics</Text>
          </TouchableOpacity>
        </View>

        {/* Horizontal ScrollView for Summary Cards */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.summaryCardsContainer}
          contentContainerStyle={styles.summaryCardsContent}
        >
          {selectedCards.map((id) => {
            const card = getCardData(id);
            return (
              <View key={card.id} style={styles.summaryCard}>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <View style={styles.cardContent}>
                  <Text style={styles.cardValue}>
                    {card.value} <Text style={styles.cardUnit}>{card.unit}</Text>
                  </Text>
                  <Text style={styles.cardSub}>{card.subText}</Text>
                </View>

                {/* Mini Graph */}
                <View style={styles.graphContainer}>
                  <LineChart
                    data={{
                      datasets: [
                        {
                          data: [13, 5, 85, 72, 78, 74, 76, 45, 60, 70, 80, 65, 75, 85, 90, 95, 100],
                          color: () => '#2f2f2f',
                          strokeWidth: 2,
                        },
                      ],
                    }}
                    width={width - 1}
                    height={60}
                    withDots={false}
                    withInnerLines={false}
                    withOuterLines={false}
                    withVerticalLabels={false}
                    withHorizontalLabels={false}
                    fromZero
                    chartConfig={{
                      backgroundGradientFrom: cardBackground,
                      backgroundGradientTo: cardBackground,
                      color: () => '#2f2f2f',
                      propsForBackgroundLines: { strokeWidth: 0 },
                      paddingRight: 0,
                      paddingLeft: 0,
                    }}
                    bezier
                    style={{
                      marginLeft: -80,
                      marginTop: -5,
                    }}
                  />

                  {/* Static Goal Line */}
                  <View style={styles.goalLine} />
                </View>

                {/* Goal Row */}
                <View style={styles.goalRow}>
                  <Text style={styles.goalText}>GOAL</Text>
                  <Text style={styles.goalValue}>{card.goal}</Text>
                </View>

                {/* Last Updated Time for BP */}
                {id === 'bp' && card.timestamp && (
                  <Text style={styles.lastUpdated}>
                    Last: {new Date(card.timestamp).toLocaleDateString()} {new Date(card.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </Text>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Quick Access Section */}
        <Text style={styles.sectionTitle}>Quick Access</Text>

        {/* Grid cards */}
        <View style={styles.grid}>
          {healthCards.map((card) => {
            const CardWrapper = card.navigation ? TouchableOpacity : View;
            return (
              <CardWrapper
                key={card.id}
                style={[
                  styles.card, 
                  { backgroundColor: cardBackground },
                  card.disabled && styles.disabledCard
                ]}
                {...(card.navigation
                  ? { onPress: () => handleCardPress(card)}
                  : {})}
                disabled={card.disabled}
              >
                <View style={[
                  styles.iconContainer, 
                  { backgroundColor: iconBackground },
                  card.disabled && styles.disabledIcon
                ]}>
                  <Image 
                    source={card.image} 
                    style={[
                      styles.icon,
                      card.disabled && styles.disabledIconImage
                    ]} 
                  />
                </View>
                <Text style={[
                  styles.cardText,
                  card.disabled && styles.disabledCardText
                ]}>
                  {card.text}
                </Text>
              </CardWrapper>
            );
          })}
        </View>
        
        {/* Add some bottom padding to ensure content doesn't get cut off */}
        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Selection Modal */}
      <Modal
        visible={showModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Metrics (Max 3)</Text>
            
            {summaryCards.map((card) => {
              const isAllowed = allowedSelectable.includes(card.id);
              const isSelected = selectedCards.includes(card.id);

              return (
                <TouchableOpacity
                  key={card.id}
                  style={[
                    styles.modalOption,
                    isSelected && styles.modalOptionSelected,
                    !isAllowed && { opacity: 0.4 }
                  ]}
                  disabled={!isAllowed}
                  onPress={() => isAllowed && toggleSummaryCard(card.id)}
                >
                  <Text style={[
                    styles.modalOptionText,
                    isSelected && styles.modalOptionTextSelected
                  ]}>
                    {card.title}
                  </Text>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowModal(false)}
            >
              <Text style={styles.modalCloseButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  </SafeAreaView>
);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  container: { 
    flex: 1, 
    backgroundColor: '#ffffff' 
  },
topBar: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingHorizontal: width * 0.05,
  paddingTop: height * 0.02,
  paddingBottom: height * 0.01,
  backgroundColor: '#ffffff',
  height: 70, // fixed height for the top bar
},
  logoContainer: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
logo: { 
  width: width * 0.35,  // bigger logo
  height: width * 0.25, // bigger logo
  resizeMode: 'contain', 
  marginRight: 4,
  position: 'absolute', // allow it to overflow top bar
  left: width * 0.01,   // align with padding
},
  menuContainer: {
    position: 'relative',
  },
  menuButton: { 
    padding: 8 
  },
  menuDots: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: '#000' 
  },
  menuDropdown: {
    position: 'absolute',
    right: 0,
    top: 40,
    width: width * 0.5,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 100,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  menuItemText: {
    fontSize: 14,
    color: '#333',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: width * 0.05,
    paddingVertical: height * 0.02,
    backgroundColor: globalStyles.primaryColor.color,
  },
  profileImage: { 
    width: width * 0.12, 
    height: width * 0.12, 
    borderRadius: width * 0.06, 
    marginRight: 10 
  },
  welcomeText: { 
    color: '#fff', 
    fontSize: width * 0.035 
  },
  userName: { 
    color: '#fff', 
    fontSize: width * 0.045, 
    fontWeight: 'bold' 
  },
  metricsCategoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: width * 0.05,
    marginTop: 15,
    marginBottom: 10,
  },
  categoryText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2f2f2f',
  },
  scrollView: { 
    flex: 1,
  },
  scrollContent: { 
    flexGrow: 1,
    paddingBottom: 30 
  },
  summaryCardsContainer: {
    minHeight: height * 0.3  // Dynamic height based on number of cards
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2f2f2f',
    marginHorizontal: width * 0.05,
    marginTop: 20,
    marginBottom: 10,
  },
  floatingButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    elevation: 3,
  },
  floatingButtonText: { 
    color: '#fff', 
    fontWeight: 'bold', 
    fontSize: 12 
  },
  summaryCard: {
    backgroundColor: '#efefef',
    borderRadius: 12,
    marginHorizontal: width * 0.05,
    marginTop: 10,
    padding: 15,
    height: height * 0.30, // Reduced height from 0.30 to 0.25
    borderWidth: 1,
    borderColor: '#d9d9d9',
    justifyContent: 'space-between',
  },
  cardContent: { 
    alignItems: 'center',
    marginTop: 5,
    marginBottom: 5,
  },
  cardTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: '#000', 
    textAlign: 'center' 
  },
  cardValue: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: '#2f2f2f', 
    textAlign: 'center' 
  },
  cardUnit: { 
    fontSize: 16, 
    fontWeight: 'normal', 
    color: '#666' 
  },
  cardSub: { 
    fontSize: 14, 
    color: '#555', 
    textAlign: 'center',
    marginTop: 5,
  },
  goalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  goalText: { 
    fontSize: 13, 
    color: '#2f2f2f' 
  },
  goalValue: { 
    fontSize: 13, 
    color: '#2f2f2f', 
    fontWeight: 'bold' 
  },
  grid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    justifyContent: 'space-between', 
    paddingHorizontal: width * 0.05, 
    marginTop: 5,
    marginBottom: 5,
  },
  card: {
    width: width * 0.29,
    height: width * 0.29,
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 15,
    marginBottom: width * 0.03,
    padding: width * 0.02,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  iconContainer: { 
    width: width * 0.18, 
    height: width * 0.18, 
    borderRadius: width * 0.09, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: iconBackground,
  },
  icon: { 
    width: width * 0.15, 
    height: width * 0.15, 
    resizeMode: 'contain',
  },
  cardText: { 
    color: '#2f2f2f', 
    fontSize: width * 0.029,
    fontWeight: '600', 
    marginTop: height * 0.005,
    textAlign: 'center' 
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  modalContent: { 
    backgroundColor: '#fff', 
    width: width * 0.8, 
    borderRadius: 12, 
    padding: 15 
  },
  modalTitle: { 
    fontSize: 17, 
    fontWeight: 'bold', 
    marginBottom: 15, 
    textAlign: 'center', 
    color: '#2f2f2f' 
  },
  modalOption: { 
    paddingVertical: 12, 
    paddingHorizontal: 15, 
    borderBottomWidth: 1, 
    borderBottomColor: '#eee', 
    flexDirection: 'row', 
    justifyContent: 'space-between',
    alignItems: 'center' 
  },
  modalOptionSelected: { 
    backgroundColor: '#f0f8ff' 
  },
  modalOptionText: { 
    fontSize: 15, 
    color: '#333' 
  },
  modalOptionTextSelected: { 
    color: globalStyles.primaryColor.color, 
    fontWeight: 'bold' 
  },
  checkmark: { 
    color: globalStyles.primaryColor.color, 
    fontSize: 15, 
    fontWeight: 'bold' 
  },
  modalCloseButton: { 
    marginTop: 15, 
    backgroundColor: globalStyles.primaryColor.color, 
    padding: 10, 
    borderRadius: 6, 
    alignItems: 'center' 
  },
  modalCloseButtonText: { 
    color: '#fff', 
    fontSize: 15, 
    fontWeight: 'bold' 
  },
  graphContainer: {
    height: 50,
    marginVertical: 5,
    backgroundColor: cardBackground,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  goalLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '95%',
    height: 2,
    backgroundColor: 'green',
  },
  bottomPadding: {
    height: 30,
  },
  disabledCard: {
  opacity: 0.5,
},
disabledIconImage: {
  opacity: 0.6,
},
disabledCardText: {
  color: '#888',
},
lastUpdated: {
  fontSize: 10,
  color: '#666',
  textAlign: 'center',
  marginTop: 5,
  fontStyle: 'italic',
}
});