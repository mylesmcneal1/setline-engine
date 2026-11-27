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


// 12: the trackpad pinch, caught for the whole window before the web view (which would turn it into a page zoom or a
// weak gesture event) and sent to the page as "pinch" {m: magnification step, x, y (the web view's points), phase}.
// Only while the pointer is over the web view of this window.
static id pinchMonitor = nil;
void setlineInstallPinch(juce::WebBrowserComponent& browser)
{
    if (pinchMonitor != nil) return;
    juce::Component::SafePointer<juce::WebBrowserComponent> safe(&browser);
    pinchMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMagnify handler:^NSEvent*(NSEvent* ev) {
        auto* b = safe.getComponent();
        if (b == nullptr || b->getPeer() == nullptr) return ev;
        NSView* root = (NSView*) b->getPeer()->getNativeHandle();
        if (root == nil || [ev window] != [root window]) return ev;
        NSView* web = nil;
        NSMutableArray* todo = [NSMutableArray arrayWithObject:root];
        while ([todo count] > 0 && web == nil) { NSView* v = [todo objectAtIndex:0]; [todo removeObjectAtIndex:0]; if ([v isKindOfClass:[WKWebView class]]) web = v; else [todo addObjectsFromArray:[v subviews]]; }
        if (web == nil) return ev;
        NSPoint p = [web convertPoint:[ev locationInWindow] fromView:nil];
        if (! [web isFlipped]) p.y = [web bounds].size.height - p.y;
        if (p.x < 0 || p.y < 0 || p.x > [web bounds].size.width || p.y > [web bounds].size.height) return ev;
        const NSEventPhase ph = [ev phase];
        const char* phase = (ph & NSEventPhaseBegan) ? "begin" : (ph & (NSEventPhaseEnded)) ? "end" : (ph & NSEventPhaseCancelled) ? "cancel" : "change";
        auto* o = new juce::DynamicObject();
        o->setProperty("m", (double) [ev magnification]); o->setProperty("x", (double) p.x); o->setProperty("y", (double) p.y); o->setProperty("phase", juce::String(phase));
        b->emitEventIfBrowserIsVisible("pinch", juce::var(o));
        return nil; // the page zooms; the web view doesn't
    }];
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
