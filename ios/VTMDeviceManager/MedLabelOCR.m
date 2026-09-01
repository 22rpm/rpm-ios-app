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

  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:nil];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = YES;

  VNImageRequestHandler *handler =
    [[VNImageRequestHandler alloc] initWithCGImage:image.CGImage options:@{}];

  NSError *error = nil;
  BOOL ok = [handler performRequests:@[request] error:&error];

  // Discard immediately, before returning anything.
  DiscardFile(filePath);

  if (!ok || error != nil) {
    reject(@"ocr_failed", error.localizedDescription ?: @"Text recognition failed.", error);
    return;
  }

  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (VNRecognizedTextObservation *observation in request.results) {
    VNRecognizedText *best = [[observation topCandidates:1] firstObject];
    if (best.string.length > 0) {
      [lines addObject:best.string];
    }
  }

  resolve([lines componentsJoinedByString:@"\n"]);
}

@end
