#import "RPMBrowser.h"
#import <SafariServices/SafariServices.h>
#import <React/RCTUtils.h>

// open(url): present SFSafariViewController for an http(s) URL, on the main queue,
// from whatever view controller is currently on top. No-op for non-web schemes.
@implementation RPMBrowser

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(open:(NSString *)urlString)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSURL *url = [NSURL URLWithString:urlString];
    if (url == nil) { return; }
    NSString *scheme = [url.scheme lowercaseString];
    if (![scheme isEqualToString:@"https"] && ![scheme isEqualToString:@"http"]) { return; }

    SFSafariViewController *safari = [[SFSafariViewController alloc] initWithURL:url];
    safari.modalPresentationStyle = UIModalPresentationPageSheet;

    UIViewController *presenter = RCTPresentedViewController();
    [presenter presentViewController:safari animated:YES completion:nil];
  });
}

@end
