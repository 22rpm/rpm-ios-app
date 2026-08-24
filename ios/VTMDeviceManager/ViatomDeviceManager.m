// ViatomDeviceManager.m
#import "ViatomDeviceManager.h"
#import <VTMProductLib/VTMProductLib.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>
#import <AVFoundation/AVFoundation.h>

static NSString * const kViatomCentralRestoreId = @"com.rpmapp.viatom.central.restore";
static const NSTimeInterval kScanRestartDelay = 0.35;
// Auto-reconnect is bounded to a wall-clock window so an off/unreachable cuff
// can't spin the scan/connect loop forever (a connect to a powered-off device
// never times out on its own). On expiry we stop, cancel the pending connect,
// and surface the failure to JS exactly once.
static const NSTimeInterval kReconnectWindow = 15.0;

// Persist keys
static NSString * const kSavedPeripheralUUIDKey = @"rpm.viatom.savedPeripheralUUID";
static NSString * const kAutoReconnectEnabledKey = @"rpm.viatom.autoReconnectEnabled";
static NSString * const kVoiceEnabledKey         = @"rpm.viatom.voiceEnabled";

@interface ViatomURATUtilsSingleton : VTMURATUtils <CBPeripheralDelegate>
+ (instancetype)sharedInstance;
@end

@implementation ViatomURATUtilsSingleton
+ (instancetype)sharedInstance {
  static ViatomURATUtilsSingleton *sharedInstance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{ sharedInstance = [[self alloc] init]; });
  return sharedInstance;
}
@end

@interface ViatomDeviceManager () <CBCentralManagerDelegate, VTMURATUtilsDelegate, VTMURATDeviceDelegate>

// BLE
@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, strong) ViatomURATUtilsSingleton *viatomUtils;
@property (nonatomic, strong) NSMutableDictionary<NSUUID*, CBPeripheral*> *peripheralsById;
@property (nonatomic, strong) NSMutableSet<NSUUID*> *seenPeripheralIds;
@property (nonatomic, strong) CBPeripheral *connectedPeripheral;
@property (nonatomic, strong) NSUUID *lastConnectedId;

// Back-compat for JS that expects this list
@property (nonatomic, strong) NSMutableArray<CBPeripheral *> *discoveredPeripherals;

// Enhanced measurement state tracking
@property (nonatomic, assign) BOOL isMeasurementInProgress;
@property (nonatomic, assign) BOOL isDeviceInitiatedMeasurement;
@property (nonatomic, assign) BOOL isWaitingForBPResult;
@property (nonatomic, assign) NSInteger lowPressureStreak;
@property (nonatomic, strong) NSDate *measurementStartTime;

// Timers
@property (nonatomic, strong) NSTimer *measurementTimeoutTimer;
@property (nonatomic, strong) NSTimer *statusPollTimer;
@property (nonatomic, strong) NSTimer *realDataPullTimer;
@property (nonatomic, strong) NSTimer *lastResultWaitTimer;

// Deploy-first flow
@property (nonatomic, assign) BOOL isDeployed;
@property (nonatomic, assign) BOOL pendingStart;

// scan options toggle to be a bit more aggressive right after disconnect
@property (nonatomic, assign) BOOL inRecoveryRescan;

// Auto-reconnect & Voice
@property (nonatomic, assign) BOOL autoReconnectEnabled;
@property (nonatomic, assign) BOOL voiceEnabled;
@property (nonatomic, strong) AVSpeechSynthesizer *tts;

@property (nonatomic, assign) BOOL hasSentFinalResult;

// Bounded auto-reconnect (kReconnectWindow, cancellable). reconnectInProgress
// gates the silent retry loop; the deadline timer owns the stop condition;
// reconnectPendingPeripheral is the connect we may need to cancel on expiry.
@property (nonatomic, strong) NSTimer *reconnectDeadlineTimer;
@property (nonatomic, assign) BOOL reconnectInProgress;
@property (nonatomic, strong) CBPeripheral *reconnectPendingPeripheral;


@end

@implementation ViatomDeviceManager

RCT_EXPORT_MODULE();

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"onDeviceDiscovered",
    @"onDeviceConnected",
    @"onDeviceDisconnected",
    @"onRealTimeData",
    @"onDeviceError",
    @"onBPModeChanged",
    @"onBPConfigReceived",
    @"onBPStatusChanged",
    @"onMeasurementResult",
    @"onReconnectFailed"
  ];
}

+ (BOOL)requiresMainQueueSetup { return YES; }

// Run every exported method on the main queue — the SAME queue the
// CBCentralManager was created with (see init). Without this, RCT dispatches
// exported methods on a background queue, so every JS command (startScan,
// connectToDevice, beginReconnect, ...) touched CoreBluetooth off its delegate
// queue — a real crash vector — and the reconnect NSTimer was scheduled on a
// background thread with no running run loop, so the 15s bound never fired on
// the startScan/focus path. Pinning to main makes CB access, the timer, and the
// reconnect-state fields (reconnectInProgress / reconnectPendingPeripheral) all
// single-threaded on main. The exported methods are lightweight command
// dispatches, so main-queue execution does not block the UI.
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (instancetype)init {
  if ((self = [super init])) {
    NSDictionary *opts = @{
      CBCentralManagerOptionShowPowerAlertKey: @YES,
      CBCentralManagerOptionRestoreIdentifierKey: kViatomCentralRestoreId
    };
    _centralManager = [[CBCentralManager alloc] initWithDelegate:self
                                                           queue:dispatch_get_main_queue()
                                                         options:opts];
    _peripheralsById = [NSMutableDictionary dictionary];
    _seenPeripheralIds = [NSMutableSet set];
    _discoveredPeripherals = [NSMutableArray array];

    _viatomUtils = [ViatomURATUtilsSingleton sharedInstance];
    _viatomUtils.delegate = self;
    _viatomUtils.deviceDelegate = self;

    _inRecoveryRescan = NO;
    
    // Enhanced state tracking
    _isMeasurementInProgress = NO;
    _isDeviceInitiatedMeasurement = NO;
    _isWaitingForBPResult = NO;
    _lowPressureStreak = 0;

    // Load persisted settings
    NSUserDefaults *ud = NSUserDefaults.standardUserDefaults;
    _autoReconnectEnabled = [ud objectForKey:kAutoReconnectEnabledKey] ? [ud boolForKey:kAutoReconnectEnabledKey] : YES;
    _voiceEnabled = [ud objectForKey:kVoiceEnabledKey] ? [ud boolForKey:kVoiceEnabledKey] : YES;
    _tts = [[AVSpeechSynthesizer alloc] init];
    [self configureAudioSessionIfNeeded];
    
    NSString *saved = [ud stringForKey:kSavedPeripheralUUIDKey];
    if (saved.length) {
      _lastConnectedId = [[NSUUID alloc] initWithUUIDString:saved];
    }
  }
  return self;
}

- (void)dealloc {
  [self.measurementTimeoutTimer invalidate];
  [self.statusPollTimer invalidate];
  [self.realDataPullTimer invalidate];
  [self.lastResultWaitTimer invalidate];
}

#pragma mark - Enhanced Error Handling

- (void)handleDeviceError:(VTMBLEPkgType)errorType command:(u_char)cmdType context:(NSString *)context {
    NSString *errorCode = @"";
    NSString *errorMessage = @"";
    BOOL isCritical = NO;

    switch (errorType) {
        case VTMBLEPkgTypeDeviceOccupied:
            errorCode = @"DEVICE_BUSY";
            errorMessage = @"Device is currently in use by another application";
            isCritical = YES;
            break;
            
        case VTMBLEPkgTypeFormatError:
            errorCode = @"FORMAT_ERROR";
            errorMessage = @"Invalid command format";
            isCritical = YES;
            break;
            
        case VTMBLEPkgTypeCRCError:
            errorCode = @"CRC_ERROR";
            errorMessage = @"Data transmission error - please reconnect device";
            isCritical = YES;
            break;
            
        case VTMBLEPkgTypeHeadError:
            errorCode = @"HEADER_ERROR";
            errorMessage = @"Communication protocol error";
            isCritical = YES;
            break;
            
        // case VTMBLEPkgTypeCommonError:
        //     errorCode = @"GENERAL_ERROR";
        //     errorMessage = @"Device operation failed";
        //     break;
            
        case VTMBLEPkgTypeNotFound:
            errorCode = @"FILE_NOT_FOUND";
            errorMessage = @"Requested data not found on device";
            break;
            
        case VTMBLEPkgTypeOpenFailed:
            errorCode = @"FILE_ACCESS_ERROR";
            errorMessage = @"Cannot access device storage";
            break;
            
        case VTMBLEPkgTypeReadFailed:
            errorCode = @"READ_ERROR";
            errorMessage = @"Failed to read from device";
            break;
            
        case VTMBLEPkgTypeWriteFailed:
            errorCode = @"WRITE_ERROR";
            errorMessage = @"Failed to write to device";
            break;
            
        case VTMBLEPkgTypeReadFileListFailed:
            errorCode = @"FILE_LIST_ERROR";
            errorMessage = @"Failed to read file list from device";
            break;
            
        case VTMBLEPkgTypeFormatUnsupport:
            errorCode = @"UNSUPPORTED_FORMAT";
            errorMessage = @"Unsupported data format";
            break;
            
        default:
            errorCode = @"UNKNOWN_ERROR";
            errorMessage = @"An unexpected error occurred";
            break;
    }

    NSLog(@"[Viatom] Device Error: %@ (0x%02X) - Command: 0x%02X - Context: %@", 
          errorCode, errorType, cmdType, context ?: @"Unknown");

    // Send structured error event
    [self sendEventWithName:@"onDeviceError"
                       body:@{@"error": errorCode,
                             @"message": errorMessage,
                             @"command": @(cmdType),
                             @"nativeErrorCode": @(errorType),
                             @"context": context ?: @"",
                             @"isCritical": @(isCritical),
                             @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))}];

    // Cleanup if measurement was in progress for critical errors
    if (isCritical && self.isMeasurementInProgress) {
        [self cleanupMeasurement:NO reason:@"device_error"];
    }

    // Voice feedback for critical errors
    if (isCritical) {
        [self speak:@"Device error occurred"];
    }
}

- (void)handleMeasurementError:(NSString *)errorCode message:(NSString *)message {
    [self sendEventWithName:@"onDeviceError"
                       body:@{@"error": errorCode,
                             @"message": message,
                             @"isCritical": @YES,
                             @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))}];
    
    [self cleanupMeasurement:NO reason:errorCode];
    [self speak:@"Measurement error"];
}

#pragma mark - Enhanced Measurement State Management

- (void)handleMeasurementStateChange:(VTMBPStatus)status {
    BOOL wasMeasuring = self.isMeasurementInProgress;
    BOOL isMeasuring = (status == VTMBPStatusBPMeasuring || 
                       status == VTMBPStatusBPAVGMeasure || 
                       status == VTMBPStatusBPMeasuringBP3 ||
                       status == VTMBPStatusECGMeasuring ||
                       status == VTMBPStatusECGMeasuringBP3);
    
    // Measurement started
    if (!wasMeasuring && isMeasuring) {
        self.isMeasurementInProgress = YES;
        self.measurementStartTime = [NSDate date];
        self.isDeviceInitiatedMeasurement = YES;
        self.isWaitingForBPResult = YES;
        self.lowPressureStreak = 0;
        self.hasSentFinalResult = NO;  
        
        [self sendEventWithName:@"onBPStatusChanged" 
                           body:@{@"status": @"measurement_started", 
                                 @"deviceInitiated": @YES,
                                 @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))}];
        
        [self startRealDataPuller];
        [self startMeasurementTimeoutTimer];
        
        [self speak:@"Measurement started"];
        
        NSLog(@"[Viatom] Measurement started - Device initiated: YES");
    }
    // Measurement ended normally
// Measurement ended normally
else if (wasMeasuring && (status == VTMBPStatusBPMeasureEnd || 
                         status == VTMBPStatusECGMeasureEnd ||
                         status == VTMBPStatusBPMeasureEndBP3 ||
                         status == VTMBPStatusECGMeasureEndBP3 ||
                         status == VTMBPStatusBPAVGMeasureEnd)) {
    [self cleanupMeasurement:YES reason:@"normal_completion"];
    [self speak:@"Measurement interrupted"]; // ← FIXED!
    
    // Give some time for the final result to come through
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (self.isWaitingForBPResult) {
            NSLog(@"[Viatom] No result received after completion, requesting final data");
            [self.viatomUtils requestBPRealData];
        }
    });
}
    // Manual stop detected (device returned to ready state)
    else if (wasMeasuring && status == VTMBPStatusReady) {
        [self handleManualStop];
    }
    // Device went to sleep or disconnected during measurement
    else if (wasMeasuring && status == VTMBPStatusSleep) {
        [self handleMeasurementError:@"DEVICE_SLEEP" 
                             message:@"Device entered sleep mode during measurement"];
    }
}

- (void)cleanupMeasurement:(BOOL)completed reason:(NSString *)reason {
    if (!self.isMeasurementInProgress) return;
    
    NSLog(@"[Viatom] Cleaning up measurement - Completed: %@, Reason: %@", 
          completed ? @"YES" : @"NO", reason);
    
    self.isMeasurementInProgress = NO;
    self.isDeviceInitiatedMeasurement = NO;
    self.isWaitingForBPResult = NO;
    self.lowPressureStreak = 0;
    
    [self stopRealDataPuller];
    [self.measurementTimeoutTimer invalidate];
    self.measurementTimeoutTimer = nil;
    [self.lastResultWaitTimer invalidate];
    self.lastResultWaitTimer = nil;
    
    NSString *status = completed ? @"measurement_completed" : @"measurement_stopped";
    [self sendEventWithName:@"onBPStatusChanged" 
                       body:@{@"status": status,
                             @"reason": reason ?: @"unknown",
                             @"duration": completed ? @(fabs([self.measurementStartTime timeIntervalSinceNow])) : @0,
                             @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))}];
}

- (void)handleManualStop {
    NSLog(@"[Viatom] Manual stop detected before completion");
    
    NSTimeInterval duration = fabs([self.measurementStartTime timeIntervalSinceNow]);
    [self sendEventWithName:@"onDeviceError"
                       body:@{@"error": @"MEASUREMENT_STOPPED",
                             @"message": @"Measurement was stopped manually before completion",
                             @"duration": @(duration),
                             @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))}];
    
    [self cleanupMeasurement:NO reason:@"manual_stop"];
    [self speak:@"Measurement stopped"];
}

#pragma mark - Voice & Persistence Helpers

- (void)persistLastConnectedId:(NSUUID *)uuid {
    if (!uuid) return;
    self.lastConnectedId = uuid;
    [[NSUserDefaults standardUserDefaults] setObject:uuid.UUIDString forKey:kSavedPeripheralUUIDKey];
    [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)persistAutoReconnect:(BOOL)enabled {
    self.autoReconnectEnabled = enabled;
    [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:kAutoReconnectEnabledKey];
    [[NSUserDefaults standardUserDefaults] synchronize];
}

#pragma mark - Bounded auto-reconnect

// Arm a fresh 15s window. Only meaningful while auto-reconnect is on and we are
// not already connected. Re-arming (e.g. focus after a disconnect) restarts the
// clock, which is what we want.
- (void)startReconnectWindow {
    if (!self.autoReconnectEnabled || self.connectedPeripheral) return;
    self.reconnectInProgress = YES;
    [self.reconnectDeadlineTimer invalidate];
    self.reconnectDeadlineTimer =
        [NSTimer scheduledTimerWithTimeInterval:kReconnectWindow
                                         target:self
                                       selector:@selector(reconnectWindowExpired)
                                       userInfo:nil
                                        repeats:NO];
}

// Tear down the window without touching the scan. cancelPending:NO is used on a
// successful connect (the "pending" peripheral is the one that just connected —
// cancelling it would drop the live connection).
- (void)clearReconnectStateCancelPending:(BOOL)cancelPending {
    [self.reconnectDeadlineTimer invalidate];
    self.reconnectDeadlineTimer = nil;
    self.reconnectInProgress = NO;
    if (cancelPending && self.reconnectPendingPeripheral) {
        [self.centralManager cancelPeripheralConnection:self.reconnectPendingPeripheral];
    }
    self.reconnectPendingPeripheral = nil;
}

// 15s elapsed with no connection: stop the loop, cancel the pending connect
// (which would otherwise pend forever against a powered-off cuff), stop the
// scan, and tell JS once so it can show a single clear "check the cuff" action.
- (void)reconnectWindowExpired {
    if (self.connectedPeripheral) { [self clearReconnectStateCancelPending:NO]; return; }
    [self clearReconnectStateCancelPending:YES];
    [self.centralManager stopScan];
    [self sendEventWithName:@"onReconnectFailed"
                       body:@{@"message": @"Couldn't connect to the cuff. Check that it's turned on."}];
}

- (void)persistVoiceEnabled:(BOOL)enabled {
    self.voiceEnabled = enabled;
    [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:kVoiceEnabledKey];
    [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)forgetSavedPeripheral {
    self.lastConnectedId = nil;
    [[NSUserDefaults standardUserDefaults] removeObjectForKey:kSavedPeripheralUUIDKey];
    [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)configureAudioSessionIfNeeded {
    AVAudioSession *session = [AVAudioSession sharedInstance];
    NSError *err = nil;
    [session setCategory:AVAudioSessionCategoryAmbient
             withOptions:AVAudioSessionCategoryOptionDuckOthers
                   error:&err];
    if (err) {
        NSLog(@"[Viatom] Audio session error: %@", err);
    }
    [session setActive:YES error:&err];
}

- (void)speak:(NSString *)phrase {
    if (!self.voiceEnabled || phrase.length == 0) return;
    
    // Don't speak if there's ongoing speech to avoid overlapping
    if (self.tts.isSpeaking) {
        [self.tts stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
    
    AVSpeechUtterance *utt = [AVSpeechUtterance speechUtteranceWithString:phrase];
    utt.rate = AVSpeechUtteranceDefaultSpeechRate;
    utt.pitchMultiplier = 1.0;
    utt.volume = 0.8;
    [self.tts speakUtterance:utt];
}

#pragma mark - Byte helpers

static inline double vt_normalize_pressure(short raw) {
    int absval = (raw >= 0 ? raw : -raw);
    return (absval > 1000) ? ((double)raw) / 100.0 : (double)raw;
}

static inline uint16_t vt_u16le(const uint8_t *p) { 
    return (uint16_t)(p[0] | (p[1] << 8)); 
}

static inline int16_t vt_s16le(const uint8_t *p) { 
    return (int16_t)(p[0] | (p[1] << 8)); 
}

static BOOL vt_plausible_result_values(uint16_t sys, uint16_t dia, uint16_t mean, uint16_t pulse) {
    if (sys < 60 || sys > 260) return NO;
    if (dia < 30 || dia > 200) return NO;
    if (mean < 30 || mean > 240) return NO;
    if (!(dia <= mean && mean <= sys)) return NO;
    if (pulse < 30 || pulse > 220) return NO;
    return YES;
}

static BOOL vt_decode_v2_rt32(const uint8_t *p, NSUInteger n,
                              double *outPressure, BOOL *outDefl,
                              BOOL *outHasPulse, int *outPulseRate) {
    if (n < 8) return NO;
    int offsets[] = {0, 8, 12, 16};
    for (int i = 0; i < (int)(sizeof(offsets)/sizeof(offsets[0])); i++) {
        int off = offsets[i];
        if (off + 6 > (int)n) continue;
        int def = p[off + 0];
        short rawP = vt_s16le(p + off + 1);
        double mmHg = vt_normalize_pressure(rawP);
        int gotPulse = p[off + 3];
        int pr = vt_u16le(p + off + 4);
        if (pr > 300 && pr < 30000) pr = pr / 100;
        BOOL plausibleP  = (mmHg >= 0.0 && mmHg <= 300.0);
        BOOL plausiblePR = (pr >= 30 && pr <= 220);
        if (plausibleP && plausiblePR) {
            *outPressure  = mmHg;
            *outDefl      = (def != 0);
            *outHasPulse  = (gotPulse != 0);
            *outPulseRate = pr;
            return YES;
        }
    }
    return NO;
}

static BOOL vt_try_extract_result(NSData *blob,
                                  uint16_t *oSys, uint16_t *oDia,
                                  uint16_t *oMean, uint16_t *oPulse) {
    if (!blob.length) return NO;

    // Try SDK parser first
    if ([VTMBLEParser respondsToSelector:@selector(parseBPResult:)]) {
        @try {
            VTMBPBPResult r = [VTMBLEParser parseBPResult:blob];
            if (vt_plausible_result_values(r.systolic_pressure, r.diastolic_pressure, r.mean_pressure, r.pulse_rate)) {
                *oSys = r.systolic_pressure; 
                *oDia = r.diastolic_pressure;
                *oMean = r.mean_pressure; 
                *oPulse = r.pulse_rate;
                return YES;
            }
        } @catch (NSException *e) {
            NSLog(@"[Viatom] SDK parser exception: %@", e);
        }
    }

    // Fallback to manual parsing
    const uint8_t *p = (const uint8_t *)blob.bytes;
    const NSUInteger n = blob.length;
    for (NSUInteger i = 0; i + 8 <= n; i++) {
        uint16_t sys = vt_u16le(p + i);
        uint16_t dia = vt_u16le(p + i + 2);
        uint16_t mean = vt_u16le(p + i + 4);
        uint16_t pulse = vt_u16le(p + i + 6);
        if (vt_plausible_result_values(sys, dia, mean, pulse)) {
            *oSys = sys; *oDia = dia; *oMean = mean; *oPulse = pulse;
            return YES;
        }
    }
    return NO;
}

#pragma mark - Central creation & restoration

- (void)centralManager:(CBCentralManager *)central willRestoreState:(NSDictionary<NSString *,id> *)dict {
    NSArray *restored = dict[CBCentralManagerRestoredStatePeripheralsKey];
    for (CBPeripheral *p in restored) {
        self.peripheralsById[p.identifier] = p;
        [self.seenPeripheralIds addObject:p.identifier];
        if (p.state == CBPeripheralStateConnected || p.state == CBPeripheralStateConnecting) {
            self.connectedPeripheral = p;
            self.lastConnectedId = p.identifier;

            p.delegate = self.viatomUtils;
            self.viatomUtils.peripheral = p;
            self.viatomUtils.delegate = self;
            self.viatomUtils.deviceDelegate = self;

            [self sendEventWithName:@"onDeviceConnected"
                               body:@{@"name": p.name ?: @"Unknown",
                                      @"id": p.identifier.UUIDString,
                                      @"restored": @YES}];

            [self speak:@"Device reconnected"];
        }
    }
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    NSString *stateString = @"";
    switch (central.state) {
        case CBManagerStatePoweredOn:
            stateString = @"PoweredOn";
            [self beginScanNormal];
            break;
        case CBManagerStatePoweredOff:
            stateString = @"PoweredOff";
            [self handleDeviceError:VTMBLEPkgTypeCommonError command:0xFF context:@"Bluetooth powered off"];
            break;
        case CBManagerStateUnauthorized:
            stateString = @"Unauthorized";
            [self handleDeviceError:VTMBLEPkgTypeCommonError command:0xFF context:@"Bluetooth unauthorized"];
            break;
        case CBManagerStateUnsupported:
            stateString = @"Unsupported";
            [self handleDeviceError:VTMBLEPkgTypeCommonError command:0xFF context:@"Bluetooth unsupported"];
            break;
        case CBManagerStateResetting:
            stateString = @"Resetting";
            break;
        case CBManagerStateUnknown:
        default:
            stateString = @"Unknown";
            break;
    }
    
    NSLog(@"[Viatom] Bluetooth state: %@", stateString);
    
    if (central.state != CBManagerStatePoweredOn) {
        [self sendEventWithName:@"onDeviceError"
                           body:@{@"error": @"BLUETOOTH_UNAVAILABLE",
                                 @"message": [NSString stringWithFormat:@"Bluetooth is %@", stateString],
                                 @"state": @(central.state)}];
    }
}

- (void)beginScanNormal {
    [self.centralManager stopScan];
    [self.discoveredPeripherals removeAllObjects];
    [self.peripheralsById removeAllObjects];
    [self.seenPeripheralIds removeAllObjects];

    NSDictionary *opts = @{ CBCentralManagerScanOptionAllowDuplicatesKey: @NO };
    [self.centralManager scanForPeripheralsWithServices:nil options:opts];

    // Try to surface the last device visually as discovered
    if (self.lastConnectedId) {
        NSArray<CBPeripheral*> *retrieved = [self.centralManager retrievePeripheralsWithIdentifiers:@[self.lastConnectedId]];
        for (CBPeripheral *p in retrieved) {
            self.peripheralsById[p.identifier] = p;
            if (![self.seenPeripheralIds containsObject:p.identifier]) {
                [self.seenPeripheralIds addObject:p.identifier];
                [self.discoveredPeripherals addObject:p];
                [self sendEventWithName:@"onDeviceDiscovered"
                                   body:@{@"name": p.name ?: @"Unknown",
                                          @"id": p.identifier.UUIDString,
                                          @"rssi": @0,
                                          @"saved": @YES}];
            }
            // Auto-connect if enabled and not already connected
            if (self.autoReconnectEnabled && p.state == CBPeripheralStateDisconnected) {
                // Arm the bounded window at the auto-connect site itself: this
                // path also fires from app launch / Bluetooth-powered-on, not just
                // beginReconnect, and an off cuff would otherwise loop unbounded.
                // Guarded so it arms once per session, not on every 0.35s retry.
                if (!self.reconnectInProgress) [self startReconnectWindow];
                self.reconnectPendingPeripheral = p;
                [self.centralManager connectPeripheral:p options:nil];
            }
        }
    }
}

- (void)beginScanRecovery {
    self.inRecoveryRescan = YES;
    [self.centralManager stopScan];
    [self.discoveredPeripherals removeAllObjects];
    [self.peripheralsById removeAllObjects];
    [self.seenPeripheralIds removeAllObjects];

    NSDictionary *opts = @{ CBCentralManagerScanOptionAllowDuplicatesKey: @YES };
    [self.centralManager scanForPeripheralsWithServices:nil options:opts];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.8 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        self.inRecoveryRescan = NO;
        [self beginScanNormal];
    });
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                  RSSI:(NSNumber *)RSSI
{
    NSString *deviceName = peripheral.name ?: advertisementData[CBAdvertisementDataLocalNameKey] ?: @"Unknown";
    NSArray *supportedPrefixes = @[@"Viatom", @"ER1", @"ER2", @"BP2A", @"BP2", @"BP2W", @"Checkme", @"BP2Pro"];
    BOOL prefixOK = NO; 
    for (NSString *pre in supportedPrefixes) { 
        if ([deviceName hasPrefix:pre]) { 
            prefixOK = YES; 
            break; 
        } 
    }
    if (!prefixOK) return;

    if (![self.seenPeripheralIds containsObject:peripheral.identifier]) {
        [self.seenPeripheralIds addObject:peripheral.identifier];
        self.peripheralsById[peripheral.identifier] = peripheral;
        [self.discoveredPeripherals addObject:peripheral];

        [self sendEventWithName:@"onDeviceDiscovered"
                           body:@{@"name": deviceName,
                                  @"id": peripheral.identifier.UUIDString,
                                  @"rssi": RSSI ?: @0,
                                  @"saved": @(self.lastConnectedId && [peripheral.identifier isEqual:self.lastConnectedId])}];
    } else {
        self.peripheralsById[peripheral.identifier] = peripheral;
    }

    // If this is our saved device and auto-reconnect is ON, connect immediately
    if (self.autoReconnectEnabled &&
        self.lastConnectedId &&
        [peripheral.identifier isEqual:self.lastConnectedId] &&
        peripheral.state == CBPeripheralStateDisconnected) {
        // Same as the retrieve path: bound this auto-connect regardless of what
        // triggered the scan (arms once per session).
        if (!self.reconnectInProgress) [self startReconnectWindow];
        self.reconnectPendingPeripheral = peripheral;
        [self.centralManager connectPeripheral:peripheral options:nil];
    }
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    [self.centralManager stopScan];
    // Connected — the reconnect window is done. Don't cancel the pending
    // peripheral: it IS this now-live connection.
    [self clearReconnectStateCancelPending:NO];
    self.connectedPeripheral = peripheral;
    [self persistLastConnectedId:peripheral.identifier];

    peripheral.delegate = self.viatomUtils;
    self.viatomUtils.peripheral = peripheral;
    self.viatomUtils.delegate = self;
    self.viatomUtils.deviceDelegate = self;

    self.isDeployed = NO;
    self.pendingStart = NO;

    [self sendEventWithName:@"onDeviceConnected"
                       body:@{@"name": peripheral.name ?: @"Unknown",
                              @"id": peripheral.identifier.UUIDString,
                              @"autoReconnect": @(self.autoReconnectEnabled)}];

    [self speak:@"Device connected"];

    // Start passive status polling
    [self startStatusPoller];
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    if (self.reconnectInProgress) {
        // Bounded silent retry. Deliberately no handleDeviceError here: emitting
        // onDeviceError every ~0.35s drove a setState storm in JS that froze the
        // UI. The deadline timer (kReconnectWindow) is the sole stop condition;
        // it surfaces the failure once via onReconnectFailed.
        if (self.reconnectPendingPeripheral == peripheral) self.reconnectPendingPeripheral = nil;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScanRestartDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            if (self.reconnectInProgress) [self beginScanNormal];
        });
        return;
    }

    NSString *errorMsg = error.localizedDescription ?: @"Unknown error";
    [self handleDeviceError:VTMBLEPkgTypeCommonError command:0xFF context:[NSString stringWithFormat:@"Connect failed: %@", errorMsg]];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScanRestartDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self beginScanNormal];
    });
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    NSString *disconnectReason = error ? error.localizedDescription : @"Normal disconnection";
    BOOL wasMeasuring = self.isMeasurementInProgress;
    
    if (wasMeasuring) {
        [self handleMeasurementError:@"DEVICE_DISCONNECTED" 
                             message:@"Device disconnected during measurement"];
    }
    
    [self sendEventWithName:@"onDeviceDisconnected"
                       body:@{@"name": peripheral.name ?: @"Unknown",
                              @"id": peripheral.identifier.UUIDString,
                              @"error": disconnectReason,
                              @"wasMeasuring": @(wasMeasuring)}];

    [self speak:@"Device disconnected"];
    [self exitBPMode];
    [self stopStatusPoller];
    
    [self.measurementTimeoutTimer invalidate];
    [self.statusPollTimer invalidate];
    [self.realDataPullTimer invalidate];
    [self.lastResultWaitTimer invalidate];
    self.measurementTimeoutTimer = nil;
    self.statusPollTimer = nil;
    self.realDataPullTimer = nil;
    self.lastResultWaitTimer = nil;

    self.isDeployed = NO;
    self.pendingStart = NO;

    self.viatomUtils.delegate = self;
    self.viatomUtils.deviceDelegate = self;
    self.viatomUtils.peripheral = nil;
    peripheral.delegate = nil;

    self.connectedPeripheral = nil;

    // The cuff commonly auto-powers-off after a reading. Bound the reconnect so
    // that if it stays off, we stop after kReconnectWindow instead of looping.
    if (self.autoReconnectEnabled) {
        [self startReconnectWindow];
    }

    // Kick aggressive rescan
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScanRestartDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self beginScanRecovery];
    });
}

#pragma mark - VTMURATDeviceDelegate (deploy)

- (void)utilDeployCompletion:(VTMURATUtils * _Nonnull)util {
    NSLog(@"[SDK] Deploy completed ✅");
    self.isDeployed = YES;
    [self.viatomUtils requestDeviceInfo];
    [self.viatomUtils requestBPConfig];
    if (self.pendingStart) { 
        self.pendingStart = NO; 
        [self _startBPAfterReady]; 
    }
}

- (void)utilDeployFailed:(VTMURATUtils * _Nonnull)util {
    NSLog(@"[SDK] Deploy failed ❌");
    self.isDeployed = NO;
    [self handleDeviceError:VTMBLEPkgTypeCommonError command:0xFF context:@"Device setup failed"];
}

#pragma mark - VTMURATUtilsDelegate (command responses)

- (void)util:(VTMURATUtils *)util
commandSendFailed:(u_char)errorCode {
    NSLog(@"[Viatom] Command send failed with code: %d", errorCode);
    [self handleDeviceError:VTMBLEPkgTypeCommonError command:0xFF context:@"Command send failed"];
}

- (void)util:(VTMURATUtils *)util
commandFailed:(u_char)cmdType
 deviceType:(VTMDeviceType)deviceType
 failedType:(VTMBLEPkgType)type {
    
    NSLog(@"[Viatom] Command 0x%02X failed with error: %d", cmdType, type);
    [self handleDeviceError:type command:cmdType context:@"Command execution failed"];
}

- (void)util:(VTMURATUtils *)util
commandCompletion:(u_char)cmdType
 deviceType:(VTMDeviceType)deviceType
    response:(NSData *)response
{
    RCTLogInfo(@"[Viatom] commandCompletion cmd:0x%02X devType:%d respLen:%lu",
               cmdType, deviceType, (unsigned long)response.length);

    if (cmdType == VTMBPCmdGetRealData) {
        const uint8_t *p = (const uint8_t *)response.bytes;
        const NSUInteger n = response.length;
        
        if (n == 2) {
            const double mmHg = vt_normalize_pressure(vt_s16le(p));
            [self sendEventWithName:@"onRealTimeData" body:@{
                @"type": @"BP_PROGRESS", @"pressure": @(mmHg),
                @"isDeflating": @NO, @"isInflating": @YES,
                @"hasPulse": @NO, @"pulseRate": @0,
                @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
            }];
            return;
        }

        if (n == 21) {
            u_char is_deflating = p[0];
            short pressure_raw = vt_s16le(p+1);
            u_char is_get_pulse = p[3];
            u_short pulse_rate = vt_u16le(p+4);
            u_char is_deflating_2 = p[6];
            const double mmHg = vt_normalize_pressure(pressure_raw);

            const BOOL defl = (is_deflating || is_deflating_2);
            [self sendEventWithName:@"onRealTimeData" body:@{
                @"type": @"BP_PROGRESS",
                @"pressure": @(mmHg),
                @"isDeflating": @(defl),
                @"isInflating": @(!defl),
                @"hasPulse": @((BOOL)is_get_pulse),
                @"pulseRate": @(pulse_rate),
                @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
            }];

            if (defl && mmHg < 10.0 && self.isWaitingForBPResult) {
                self.lowPressureStreak++;
                if (self.lowPressureStreak >= 3) {
                    [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
                    self.isWaitingForBPResult = NO;
                    [self.measurementTimeoutTimer invalidate];
                    self.measurementTimeoutTimer = nil;
                    [self exitBPMode];
                }
            } else { 
                self.lowPressureStreak = 0; 
            }
            return;
        }

        if (n == 20) {
            uint16_t sys = vt_u16le(p + 3);
            uint16_t dia = vt_u16le(p + 5);
            uint16_t mean = vt_u16le(p + 7);
            uint16_t pulse = vt_u16le(p + 9);
            if (vt_plausible_result_values(sys, dia, mean, pulse)) {
                [self sendFinalBPResultOnce:@{

                  @"type": @"BP_RESULT",
                  @"systolic": @(sys), @"diastolic": @(dia),
                  @"meanPressure": @(mean), @"pulse": @(pulse),
                  @"stateCode": @((u_char)p[11]),
                  @"medicalResult": @((u_char)p[12]),
                  @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
                }];
                self.isWaitingForBPResult = NO;
                [self.measurementTimeoutTimer invalidate];
                self.measurementTimeoutTimer = nil;
                [self exitBPMode];
                return;
            }
        }

        if (n == 32) {
            double mmHg = 0.0; BOOL defl = NO; BOOL hasPulse = NO; int pr = 0;
            if (vt_decode_v2_rt32(p, n, &mmHg, &defl, &hasPulse, &pr)) {
                [self sendEventWithName:@"onRealTimeData" body:@{
                  @"type": @"BP_PROGRESS",
                  @"pressure": @(mmHg),
                  @"isDeflating": @(defl), @"isInflating": @(!defl),
                  @"hasPulse": @(hasPulse), @"pulseRate": @(pr),
                  @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
                }];
                if (defl && mmHg < 10.0 && self.isWaitingForBPResult) {
                  self.lowPressureStreak++;
                  if (self.lowPressureStreak >= 3) {
                    [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
                    self.isWaitingForBPResult = NO;
                    [self.measurementTimeoutTimer invalidate];
                    self.measurementTimeoutTimer = nil;
                    [self exitBPMode];
                  }
                } else { 
                    self.lowPressureStreak = 0; 
                }
                return;
            }
        }

if (n == 34 || n == 36 || n == 38 || n == 40 || n == 44) {
    uint16_t sys=0,dia=0,mean=0,pulse=0;
    if (vt_try_extract_result(response, &sys, &dia, &mean, &pulse)) {
        NSLog(@"[Viatom] ✅ Final BP Result extracted: %d/%d mmHg, Pulse: %d", sys, dia, pulse);
        [self sendFinalBPResultOnce:@{

          @"type": @"BP_RESULT",
          @"systolic": @(sys), @"diastolic": @(dia),
          @"meanPressure": @(mean), @"pulse": @(pulse),
          @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
        }];
        
        self.isWaitingForBPResult = NO;
        [self.measurementTimeoutTimer invalidate];
        self.measurementTimeoutTimer = nil;
        
        // Speak success
        [self speak:[NSString stringWithFormat:@"Measurement complete. Blood pressure %d over %d. Pulse %d.", sys, dia, pulse]];
        
        [self exitBPMode];
        return;
    } else {
        NSLog(@"[Viatom] ❌ Could not extract valid result from %lu bytes", (unsigned long)n);
    }
}

        @try {
            VTMBPRealTimeData rt = [VTMBLEParser parseBPRealTimeData:response];
            if (rt.run_status.status == VTMBPStatusBPMeasureEnd) {
                [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
                [self.lastResultWaitTimer invalidate];
                self.lastResultWaitTimer = [NSTimer scheduledTimerWithTimeInterval:0.8
                                                                            target:self
                                                                          selector:@selector(forceExitAfterNoResult)
                                                                          userInfo:nil
                                                                           repeats:NO];
                return;
            }
        } @catch (NSException *e) {
            NSLog(@"[Viatom] Error parsing realtime data: %@", e);
        }
        return;
    }

    if (cmdType == VTMBPCmdGetRealStatus) {
        @try {
            VTMBPRunStatus s = [VTMBLEParser parseBPRealTimeStatus:response];
            [self sendEventWithName:@"onRealTimeData" body:@{
              @"type": @"BP_STATUS_UPDATE",
              @"status": @(s.status),
              @"batteryLevel": @(s.battery.percent),
              @"isCharging": @(s.battery.state > 0),
              @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
            }];
            
            // Enhanced measurement state management
            [self handleMeasurementStateChange:s.status];
            
            // Auto-start when device button is pressed
            if (s.status == VTMBPStatusBPMeasuring && !self.isMeasurementInProgress && self.isDeployed) {
                RCTLogInfo(@"[Viatom] Auto-start detected from device button press ✅");
                [self handleMeasurementStateChange:VTMBPStatusBPMeasuring];
            }
            
        } @catch (NSException *exception) {
            NSLog(@"[Viatom] Error parsing status: %@", exception);
            [self handleDeviceError:VTMBLEPkgTypeCommonError command:cmdType context:@"Status parse error"];
        }
        return;
    }
}

#pragma mark - Pollers

- (void)startStatusPoller {
    [self.statusPollTimer invalidate];
    self.statusPollTimer = [NSTimer scheduledTimerWithTimeInterval:1.0
                                                          target:self
                                                        selector:@selector(pollRunStatus)
                                                        userInfo:nil
                                                         repeats:YES];
}

- (void)stopStatusPoller {
    [self.statusPollTimer invalidate];
    self.statusPollTimer = nil;
}

- (void)pollRunStatus {
    if (self.viatomUtils && self.connectedPeripheral) {
        [self.viatomUtils bp_requestRealStatus];
    }
}

- (void)startRealDataPuller {
    [self.realDataPullTimer invalidate];
    self.realDataPullTimer = [NSTimer scheduledTimerWithTimeInterval:0.12
                                                            target:self
                                                          selector:@selector(pullRealData)
                                                          userInfo:nil
                                                           repeats:YES];
}

- (void)stopRealDataPuller {
    [self.realDataPullTimer invalidate];
    self.realDataPullTimer = nil;
}

- (void)pullRealData {
    if (self.isMeasurementInProgress && self.connectedPeripheral) {
        [self.viatomUtils requestBPRealData];
    }
}

- (void)startMeasurementTimeoutTimer {
    [self.measurementTimeoutTimer invalidate];
    self.measurementTimeoutTimer = [NSTimer scheduledTimerWithTimeInterval:180.0
                                                                   target:self
                                                                 selector:@selector(measurementTimeout)
                                                                 userInfo:nil
                                                                  repeats:NO];
}

#pragma mark - Device info callback

- (void)deviceInfo:(VTMDeviceInfo)info {
    if (self.connectedPeripheral) {
        [self sendEventWithName:@"onDeviceConnected"
                           body:@{
                             @"name": self.connectedPeripheral.name ?: @"Unknown",
                             @"id": self.connectedPeripheral.identifier.UUIDString,
                             @"deviceType": @(info.device_type),
                             @"fwVersion": @(info.fw_version),
                             @"hwVersion": @(info.hw_version),
                             @"protocolVersion": @(info.protocol_version)
                           }];
    }
}

#pragma mark - Helpers

- (void)exitBPMode {
    if (self.isMeasurementInProgress) {
        [self.viatomUtils requestChangeBPState:2]; // to History; exits BP mode safely
        [self cleanupMeasurement:NO reason:@"mode_exit"];
    }
}

- (void)measurementTimeout {
    [self handleMeasurementError:@"MEASUREMENT_TIMEOUT" 
                         message:@"The measurement took too long. Please try again."];
}

- (void)forceExitAfterNoResult {
    self.lastResultWaitTimer = nil;
    if (self.isMeasurementInProgress) {
        NSLog(@"[Viatom] Force exit - no result received after completion");
        
        // Try multiple attempts to get the result
        __block int attempt = 0;
        __block NSTimer *retryTimer = [NSTimer scheduledTimerWithTimeInterval:0.5
                                                                      repeats:YES
                                                                        block:^(NSTimer * _Nonnull timer) {
            attempt++;
            NSLog(@"[Viatom] Result retry attempt %d", attempt);
            [self.viatomUtils requestBPRealData];
            
            if (attempt >= 3) {
                [timer invalidate];
                if (self.isMeasurementInProgress) {
                    NSLog(@"[Viatom] Giving up after %d attempts", attempt);
                    [self handleMeasurementError:@"NO_RESULT" 
                                         message:@"Measurement completed but no result received after multiple attempts"];
                }
            }
        }];
        
        // Auto-stop the retry after 3 seconds
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [retryTimer invalidate];
        });
    }
}

#pragma mark - Start only after deploy

- (void)_startBPAfterReady {
    [self.measurementTimeoutTimer invalidate];
    [self.realDataPullTimer invalidate];
    [self.lastResultWaitTimer invalidate];
    
    [self.viatomUtils requestChangeBPState:0]; // enter BP mode
    self.isMeasurementInProgress = YES;
    self.isDeviceInitiatedMeasurement = NO; // App-initiated
    self.isWaitingForBPResult = YES;
    self.lowPressureStreak = 0;
    self.hasSentFinalResult = NO;

    self.measurementStartTime = [NSDate date];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self.viatomUtils requestBPRealData];
        [self startRealDataPuller];
    });
    
    [self startStatusPoller];
    [self startMeasurementTimeoutTimer];

    [self sendEventWithName:@"onRealTimeData"
                       body:@{@"type": @"BP_REALDATA_REQUESTED",
                              @"message": @"Request real data."}];

    [self sendEventWithName:@"onBPModeChanged" body:@{@"active": @YES}];
    [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_started", @"deviceInitiated": @NO}];
}

#pragma mark - RN Exports

RCT_EXPORT_METHOD(startScan) {
    if (self.centralManager.state == CBManagerStatePoweredOn) {
        [self beginScanNormal];
    } else {
        [self sendEventWithName:@"onDeviceError"
                           body:@{@"error": @"BLUETOOTH_OFF",
                                 @"message": @"Bluetooth is not available"}];
    }
}

RCT_EXPORT_METHOD(stopScan) {
    [self.centralManager stopScan];
}

RCT_EXPORT_METHOD(connectToDevice:(NSString *)deviceId) {
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:deviceId];
    CBPeripheral *target = self.peripheralsById[uuid];
    if (!target) {
        NSArray<CBPeripheral*> *retrieved = [self.centralManager retrievePeripheralsWithIdentifiers:@[uuid]];
        target = retrieved.firstObject;
        if (target) {
            self.peripheralsById[uuid] = target;
        }
    }
    if (target) {
        [self persistLastConnectedId:uuid];
        [self persistAutoReconnect:YES];
        [self.centralManager connectPeripheral:target options:nil];
    } else {
        [self handleDeviceError:VTMBLEPkgTypeCommonError command:0xFF context:@"Device not found"];
    }
}

RCT_EXPORT_METHOD(disconnectDevice) {
    if (self.connectedPeripheral) {
        BOOL wasMeasuring = self.isMeasurementInProgress;
        
        if (wasMeasuring) {
            [self cleanupMeasurement:NO reason:@"manual_disconnect"];
        }
        
        [self.measurementTimeoutTimer invalidate];
        [self.statusPollTimer invalidate];
        [self.realDataPullTimer invalidate];
        [self.lastResultWaitTimer invalidate];
        self.measurementTimeoutTimer = nil;
        self.statusPollTimer = nil;
        self.realDataPullTimer = nil;
        self.lastResultWaitTimer = nil;
        
        self.viatomUtils.peripheral = nil;
        self.connectedPeripheral.delegate = nil;

        [self.centralManager cancelPeripheralConnection:self.connectedPeripheral];
        self.connectedPeripheral = nil;

        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScanRestartDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self beginScanNormal];
        });
    }
}

RCT_EXPORT_METHOD(requestBPConfig) {
    if (self.connectedPeripheral) { 
        [self.viatomUtils requestBPConfig]; 
    }
}

RCT_EXPORT_METHOD(requestBPRunStatus) {
    if (self.viatomUtils && self.connectedPeripheral) { 
        [self.viatomUtils bp_requestRealStatus]; 
    }
}

RCT_EXPORT_METHOD(syncBPConfig:(NSDictionary *)config) {
    if (!self.connectedPeripheral) return;
    @try {
        VTMBPConfig bpConfig;
        bpConfig.prev_calib_zero = [config[@"prevCalibZero"] unsignedIntValue];
        bpConfig.last_calib_zero = [config[@"lastCalibZero"] unsignedIntValue];
        bpConfig.calib_slope = [config[@"calibSlope"] unsignedIntValue];
        bpConfig.slope_pressure = [config[@"slopePressure"] unsignedShortValue];
        bpConfig.calib_ticks = [config[@"calibTicks"] unsignedIntValue];
        bpConfig.sleep_ticks = [config[@"sleepTicks"] unsignedIntValue];
        bpConfig.bp_test_target_pressure = [config[@"bpTestTargetPressure"] unsignedShortValue];
        bpConfig.device_switch = [config[@"deviceSwitch"] unsignedCharValue];
        bpConfig.avg_measure_mode = [config[@"avgMeasureMode"] unsignedCharValue];
        bpConfig.volume = [config[@"volume"] unsignedCharValue];
        bpConfig.time_utc = [config[@"timeUTC"] unsignedCharValue];
        bpConfig.wifi_4g_switch = [config[@"wifi4gSwitch"] unsignedCharValue];
        bpConfig.unit = [config[@"unit"] unsignedCharValue];
        bpConfig.language = [config[@"language"] unsignedCharValue];
        [self.viatomUtils syncBPConfig:bpConfig];
    } @catch (NSException *exception) {
        [self handleDeviceError:VTMBLEPkgTypeFormatError command:VTMBPCmdSetConfig context:@"Config sync error"];
    }
}

RCT_EXPORT_METHOD(requestDeviceInfo) {
    if (self.connectedPeripheral) { 
        [self.viatomUtils requestDeviceInfo]; 
    }
}

RCT_EXPORT_METHOD(requestBatteryInfo) {
    if (self.connectedPeripheral) { 
        [self.viatomUtils requestBatteryInfo]; 
    }
}

RCT_EXPORT_METHOD(enterECGMode) {
    if (self.connectedPeripheral) {
        [self.viatomUtils requestChangeBPState:1];
        [self cleanupMeasurement:NO reason:@"mode_switch"];
    }
}

RCT_EXPORT_METHOD(enterHistoryMode) {
    if (self.connectedPeripheral) {
        [self.viatomUtils requestChangeBPState:2];
        [self cleanupMeasurement:NO reason:@"mode_switch"];
    }
}

// Runtime toggles from JS
RCT_EXPORT_METHOD(enableAutoReconnect:(BOOL)enabled) {
    [self persistAutoReconnect:enabled];
}

// Start a bounded reconnect attempt (screen focus). Native owns the stop
// condition, so JS no longer needs its own retry timer.
RCT_EXPORT_METHOD(beginReconnect) {
    if (self.connectedPeripheral) return;
    [self startReconnectWindow];
    if (self.centralManager.state == CBManagerStatePoweredOn) {
        [self beginScanNormal];
    }
}

// Cancel any in-flight reconnect (screen blur / leaving the screen), so the
// scan/connect loop does not keep running in the background.
RCT_EXPORT_METHOD(cancelReconnect) {
    [self clearReconnectStateCancelPending:YES];
    [self.centralManager stopScan];
}

RCT_EXPORT_METHOD(forgetSavedDevice) {
    [self forgetSavedPeripheral];
}

RCT_EXPORT_METHOD(setVoiceEnabled:(BOOL)enabled) {
    [self persistVoiceEnabled:enabled];
}

- (void)sendFinalBPResultOnce:(NSDictionary *)result {
    if (self.hasSentFinalResult) {
        NSLog(@"[Viatom] ⚠️ Duplicate BP result blocked");
        return;
    }

    self.hasSentFinalResult = YES;

    [self sendEventWithName:@"onMeasurementResult" body:result];

    // stop timers
    self.isWaitingForBPResult = NO;
    [self.measurementTimeoutTimer invalidate];
    self.measurementTimeoutTimer = nil;

    [self exitBPMode];
}


@end