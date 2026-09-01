//
//  MedLabelOCR.h
//  RPM_App
//
//  On-device medication-label OCR using Apple's Vision framework. No third-party OCR
//  dependency. Reads text from a captured image file, then DELETES that file — the
//  photo is never retained (medications step 5). See labelOcr.js / MEDICATIONS_DESIGN.md.
//

#import <React/RCTBridgeModule.h>

@interface MedLabelOCR : NSObject <RCTBridgeModule>
@end
