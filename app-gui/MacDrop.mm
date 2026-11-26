// set.Line desktop app (macOS): let the window, not the WKWebView, take dragged files.
// A page only gets File objects without paths, so the JUCE window (WebUi, a FileDragAndDropTarget)
// handles the drop and passes the real paths to the page. AppKit sends a drag to the deepest view
// registered for it, so the web view stops registering for drags and the JUCE view behind it gets them.
#include <juce_gui_extra/juce_gui_extra.h>
#import <WebKit/WebKit.h>

namespace setline::gui {

static void stopDrops(NSView* v)
{
    if ([v isKindOfClass:[WKWebView class]]) [v unregisterDraggedTypes];
    for (NSView* sub in [v subviews]) stopDrops(sub);
}

void stopWebViewFileDrops(juce::Component& browser)
{
    if (auto* peer = browser.getPeer())
        if (auto* view = (NSView*) peer->getNativeHandle()) stopDrops(view);
}


// 10b: the Edit menu's text commands, sent to the first responder (the web view) as any Mac app does
bool setlineMacEditAction(const juce::String& what)
{
    SEL sel = nil;
    if (what == "undo") sel = @selector(undo:); else if (what == "redo") sel = @selector(redo:);
    else if (what == "cut") sel = @selector(cut:); else if (what == "copy") sel = @selector(copy:);
    else if (what == "paste") sel = @selector(paste:); else if (what == "selectAll") sel = @selector(selectAll:);
    if (sel == nil) return false;
    return [NSApp sendAction:sel to:nil from:nil];
}

// The loading window honours System Settings > Accessibility > Display > Reduce motion (Splash.cpp).
bool setlineReduceMotionMac()
{
    return [[NSWorkspace sharedWorkspace] accessibilityDisplayShouldReduceMotion];
}

} // namespace setline::gui
