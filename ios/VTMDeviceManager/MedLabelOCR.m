//
//  MedLabelOCR.m
//  RPM_App
//
//  recognize(path): read the text off a captured medication-label image using Apple's
//  Vision framework (VNRecognizeTextRequest), entirely ON-DEVICE, then DELETE the image
//  file. The photo is never kept — no camera roll, no upload, no copy left behind. The
//  returned text is only used to pre-fill a draft the patient must review and correct.
//

#import "MedLabelOCR.h"
#import <Vision/Vision.h>
#import <UIKit/UIKit.h>

@implementation MedLabelOCR

RCT_EXPORT_MODULE();

// Vision work is off the main thread; nothing here touches UIKit on load.
+ (BOOL)requiresMainQueueSetup { return NO; }

// Delete the captured file no matter what happens — this is the "nothing is stored"
// guarantee, enforced in native code rather than trusted to JS.
static void DiscardFile(NSString *filePath) {
  if (filePath.length == 0) { return; }
  [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];
}

// Reads BOTH a barcode (preferred — an NDC barcode maps to an exact product) and the
// text lines (fallback — shown to the patient to pick from; we never guess the name).
// Returns { "barcodes": [{payload, symbology}], "lines": [String] }.
RCT_EXPORT_METHOD(recognize:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *filePath = [path stringByReplacingOccurrencesOfString:@"file://" withString:@""];

  UIImage *image = [UIImage imageWithContentsOfFile:filePath];
  if (image == nil || image.CGImage == NULL) {
    DiscardFile(filePath);
    reject(@"no_image", @"Could not read the captured image.", nil);
    return;
  }

  VNDetectBarcodesRequest *barcodeReq =
    [[VNDetectBarcodesRequest alloc] initWithCompletionHandler:nil];

  VNRecognizeTextRequest *textReq =
    [[VNRecognizeTextRequest alloc] initWithCompletionHandler:nil];
  textReq.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  textReq.usesLanguageCorrection = YES;

  VNImageRequestHandler *handler =
    [[VNImageRequestHandler alloc] initWithCGImage:image.CGImage options:@{}];

  NSError *error = nil;
  BOOL ok = [handler performRequests:@[barcodeReq, textReq] error:&error];

  // Discard immediately, before returning anything.
  DiscardFile(filePath);

  if (!ok || error != nil) {
    reject(@"ocr_failed", error.localizedDescription ?: @"Recognition failed.", error);
    return;
  }

  NSMutableArray *barcodes = [NSMutableArray array];
  for (VNBarcodeObservation *obs in barcodeReq.results) {
    if (obs.payloadStringValue.length > 0) {
      [barcodes addObject:@{
        @"payload": obs.payloadStringValue,
        @"symbology": obs.symbology ?: @"",
      }];
    }
  }

  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (VNRecognizedTextObservation *observation in textReq.results) {
    VNRecognizedText *best = [[observation topCandidates:1] firstObject];
    if (best.string.length > 0) {
      [lines addObject:best.string];
    }
  }

  resolve(@{ @"barcodes": barcodes, @"lines": lines });
}

@end
