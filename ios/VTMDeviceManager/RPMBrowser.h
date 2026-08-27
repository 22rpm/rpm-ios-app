#import <React/RCTBridgeModule.h>

// Native bridge to open a URL in SFSafariViewController (in-app browser), so the
// patient stays inside the app instead of being kicked out to Safari.
@interface RPMBrowser : NSObject <RCTBridgeModule>
@end
