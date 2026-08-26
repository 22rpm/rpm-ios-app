import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import globalStyles from './globalStyles';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStackNavigator } from '@react-navigation/stack';
import io from "socket.io-client";
import { SafeAreaView } from 'react-native-safe-area-context';
import { MESSAGES_BASE, SOCKET_BASE } from './apiConfig';

const { width, height } = Dimensions.get('window');
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const Stack = createStackNavigator();

// ------------------- Conversations List Screen -------------------
function ConversationsList({ navigation }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  const API_BASE = MESSAGES_BASE;

  const handleBack = () => {
    navigation.navigate('Home');
  };

  const fetchConversations = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const refreshToken = await AsyncStorage.getItem('refreshToken');

      if (!token || !refreshToken) {
        console.warn('Missing tokens in AsyncStorage');
        return;
      }

      const response = await fetch(`${API_BASE}/conversations`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          // Cookie: `token=${token}; refresh_token=${refreshToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const json = await response.json();
      console.log('📡 Raw conversations response:', json);

      const mapped = json.data.map((item) => ({
        id: item.other_user_id,
        lastMessage: item.last_message,
        lastMessageTime: item.last_message_time,
        participantId: item.other_user_id,
        participantName: item.other_user_name,
        unreadCount: item.unread_count,
        avatar: null,
      }));

      setConversations(mapped);
    } catch (error) {
      console.error('Error fetching conversations:', error.message);
      Alert.alert('Error', 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchConversations();
    });
    return unsubscribe;
  }, [navigation]);

  const navigateToChat = (conversation) => {
    navigation.navigate('Chat', {
      conversationId: conversation.id,
      receiverId: conversation.participantId || 3,
      receiverName: conversation.participantName || 'Dr. Amir'
    });
  };

  const renderConversation = ({ item }) => (
    <TouchableOpacity
      style={styles.conversationItem}
      onPress={() => navigateToChat(item)}
    >
      <Image
        source={item.avatar ? { uri: item.avatar } : require('./assets/avatar.png')}
        style={styles.avatar}
      />
      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <Text style={styles.name}>{item.participantName || 'Unknown'}</Text>
          <Text style={styles.time}>
            {item.lastMessageTime ? new Date(item.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </Text>
        </View>
        <Text
          style={styles.lastMessage}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {item.lastMessage || 'No messages yet'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
            <SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
  <View style={styles.header}>
    <TouchableOpacity onPress={handleBack}>
      <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>Messages</Text>

  </View>
</SafeAreaView>
        <ActivityIndicator
          size="large"
          color={globalStyles.primaryColor.color}
          style={styles.loader}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      
<SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
  <View style={styles.header}>
    <TouchableOpacity onPress={handleBack}>
      <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>Messages</Text>

  </View>
</SafeAreaView>

      <FlatList
        data={conversations}
        renderItem={renderConversation}
        keyExtractor={item => item.id?.toString() || Math.random().toString()}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Image
              source={require('./assets/empty_chat.png')}
              style={styles.emptyImage}
            />
            <Text style={styles.emptyText}>No conversations yet</Text>
            <Text style={styles.emptySubText}>Start a conversation with your healthcare provider</Text>
          </View>
        }
      />
    </View>
  );
}

// ------------------- Chat Screen -------------------
function ChatScreen({ navigation, route }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef(null);

  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);

  // Get parameters from navigation
  const conversationId = route?.params?.conversationId || 3;
  const receiverId = route?.params?.receiverId || 3;
  const receiverName = route?.params?.receiverName || 'Dr. Amir';

  const API_BASE = MESSAGES_BASE;

  // Socket connection
  useEffect(() => {
    let newSocket;
    const initSocket = async () => {
      const token = await AsyncStorage.getItem("token");

      newSocket = io(SOCKET_BASE, {
        path: "/rpm-be/socket.io/",
        withCredentials: true,
        extraHeaders: {
          Cookie: `token=${token}`,
        },
        transports: ["websocket"],
      });

      newSocket.on("connect", () => {
        console.log("✅ Connected to socket server");
        setSocketConnected(true);
      });

      newSocket.on("disconnect", () => {
        console.log("❌ Disconnected from socket server");
        setSocketConnected(false);
      });

      newSocket.on("new_message", (msg) => {
        console.log("📩 Incoming message:", msg);
        setMessages(prev => [
          ...prev,
          {
            id: msg.id,
            text: msg.message,
            senderId: msg.sender_id,
            receiverId: msg.receiver_id,
            timestamp: msg.created_at,
          },
        ]);
      });

      setSocket(newSocket);
    };

    initSocket();

    return () => {
      if (newSocket) newSocket.disconnect();
    };
  }, []);

  // Join room when socket is connected
  useEffect(() => {
    if (socket && socketConnected) {
      console.log("➡️ Joining room:", receiverId);
      socket.emit("join_room", receiverId);
    }
  }, [socket, socketConnected, receiverId]);

  const handleBack = () => {
    navigation.goBack();
  }



  // Fetch messages history
  const fetchMessages = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      const refreshToken = await AsyncStorage.getItem('refreshToken');

      if (!token || !refreshToken) {
        throw new Error('❌ No access token found');
      }

      const url = `${API_BASE}/conversation/${receiverId}?limit=40`;
      console.log('📡 Fetching messages from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          // Cookie: `token=${token}; refresh_token=${refreshToken};`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      console.log('✅ Messages fetched:', json);

      const mapped = json.data.map(item => ({
        id: item.id,
        text: item.message,
        senderId: item.sender_id,
        senderName: item.sender_name,
        receiverId: item.receiver_id,
        timestamp: item.created_at,
      }));

      setMessages(mapped);
    } catch (error) {
      console.error('❌ Fetch messages error:', error);
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!inputText.trim()) return;

    try {
      const token = await AsyncStorage.getItem('token');
      const refreshToken = await AsyncStorage.getItem('refreshToken');

      if (!token || !refreshToken) {
        throw new Error('❌ No access token found');
      }

      const response = await fetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Cookie: `token=${token}; refresh_token=${refreshToken}`,
        },
        body: JSON.stringify({
          receiverId,
          message: inputText.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      console.log('Message sent successfully');
      const res = await response.json();

      const newMessage = {
        id: res.id || Date.now(),
        text: inputText.trim(),
        senderId: res.sender_id || (await AsyncStorage.getItem('userId')),
        senderName: res.sender_name || 'You',
        receiverId,
        timestamp: res.created_at || new Date().toISOString(),
        status: 'sent',
      };

      // setMessages(prev => [...prev, newMessage]);
      setInputText('');
    } catch (err) {
      console.error('Send message error:', err);
      Alert.alert('Error', 'Could not send message');
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [conversationId]);

  const renderMessage = ({ item }) => {
    const isUser = item.senderId !== receiverId;

    return (
      <View
        style={[
          styles.messageContainer,
          isUser ? styles.userMessageContainer : styles.supportMessageContainer,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isUser ? styles.userBubble : styles.supportBubble,
          ]}
        >
          <Text style={isUser ? styles.userMessageText : styles.supportMessageText}>
            {item.text}
          </Text>

          {isUser && (
            <Text style={styles.tickText}>
              {item.status === 'sent' && '✓'}
              {item.status === 'delivered' && '✓✓'}
              {item.status === 'read' && '✓✓'}
            </Text>
          )}
        </View>
        <Text style={styles.timeText}>
          {item.timestamp
            ? new Date(item.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            : ''}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor={globalStyles.primaryColor.color} barStyle="light-content" />

      {/* Header */}
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Image
            style={styles.backIcon}
            source={require('./assets/icon_back.png')}
          />
          {/* <Text style={styles.backText}>Back</Text> */}
        </TouchableOpacity>
        <View style={styles.headerUserInfo}>
          <Text style={styles.headerTitle}>{receiverName}</Text>
          <Text style={styles.headerSubtitle}>Online</Text>
        </View>
        <TouchableOpacity style={styles.headerCallButton}>
          {/* <Image
            style={styles.callIcon}
            source={require('./assets/icon_call.png')}
          /> */}
        </TouchableOpacity>
      </View>

      {/* Chat Messages */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={globalStyles.primaryColor.color}
          />
          <Text style={styles.loadingText}>Loading messages...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id?.toString() || Math.random().toString()}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          onLayout={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          ListEmptyComponent={
            <View style={styles.chatEmptyContainer}>
              <Image
                source={require('./assets/start_chat.png')}
                style={styles.chatEmptyImage}
              />
              <Text style={styles.chatEmptyText}>
                Start a conversation with {receiverName}
              </Text>
              <Text style={styles.chatEmptySubText}>
                Send a message to get started
              </Text>
            </View>
          }
        />
      )}

      {/* Message Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachmentButton}>
          <Image
            source={require('./assets/icon_attachment.png')}
            style={styles.attachmentIcon}
          />
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type your message..."
          placeholderTextColor="#999"
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            inputText.trim() === '' && styles.sendButtonDisabled
          ]}
          onPress={sendMessage}
          disabled={inputText.trim() === ''}>
          <Image
            source={require('./assets/icon_send.png')}
            style={styles.sendIcon}
          />
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ------------------- Main Navigation -------------------
export default function Connection({ navigation }) {
  return (
    <Stack.Navigator
      initialRouteName="ConversationsList"
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#FFFFFF' },
      }}
    >
      <Stack.Screen name="ConversationsList" component={ConversationsList} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}

// ------------------- Styles -------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
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
  headerRightPlaceholder: { width: width * 0.06 },

  listContainer: { padding: 10 },
  conversationItem: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25, marginRight: 15, backgroundColor: '#e0e0e0'
  },
  conversationContent: { flex: 1, justifyContent: 'center' },
  conversationHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  name: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  time: { fontSize: 12, color: '#999' },
  lastMessage: { fontSize: 14, color: '#666' },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 50, padding: 20 },
  emptyImage: { width: 120, height: 120, marginBottom: 20, opacity: 0.7 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#999', marginBottom: 10, textAlign: 'center' },
  emptySubText: { fontSize: 14, color: '#999', textAlign: 'center' },

  chatHeader: {
    width: '100%', height: SCREEN_HEIGHT * 0.08,
    backgroundColor: globalStyles.primaryColor.color,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 15, paddingTop: 10, elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 3,
  },
  headerUserInfo: { alignItems: 'center' },
  headerSubtitle: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 12 },
  headerCallButton: { padding: 8 },
  callIcon: { width: SCREEN_WIDTH * 0.06, height: SCREEN_WIDTH * 0.06, tintColor: '#fff' },

  messagesList: { flexGrow: 1, justifyContent: 'flex-end', padding: 10 },
  messageContainer: { marginVertical: 8, maxWidth: '75%' },
  userMessageContainer: { alignSelf: 'flex-end' },
  supportMessageContainer: { alignSelf: 'flex-start' },
  messageBubble: { borderRadius: 20, padding: 12, elevation: 2 },
  userBubble: { backgroundColor: globalStyles.primaryColor.color, borderBottomRightRadius: 0 },
  supportBubble: { backgroundColor: '#fff', borderBottomLeftRadius: 0, borderWidth: 1, borderColor: '#eee' },
  userMessageText: { fontSize: 16, color: '#fff' },
  supportMessageText: { fontSize: 16, color: '#333' },
  tickText: { fontSize: 12, color: '#666', marginTop: 4, alignSelf: 'flex-end' },
  timeText: { fontSize: 12, color: '#999', marginTop: 5 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  chatEmptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  chatEmptyImage: { width: 120, height: 120, marginBottom: 20 },
  chatEmptyText: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 10, textAlign: 'center' },
  chatEmptySubText: { fontSize: 14, color: '#666', textAlign: 'center' },

  inputContainer: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
    paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff'
  },
  attachmentButton: { padding: 8 },
  attachmentIcon: { width: 24, height: 24, tintColor: '#666' },
  textInput: {
    flex: 1, minHeight: 40, maxHeight: 100, borderRadius: 20,
    paddingHorizontal: 15, paddingVertical: 10, fontSize: 16,
    backgroundColor: '#f5f5f5', color: '#000', marginHorizontal: 8,
  },
  sendButton: { padding: 8 },
  sendButtonDisabled: { opacity: 0.5 },
  sendIcon: { width: 28, height: 28, tintColor: globalStyles.primaryColor.color },
});