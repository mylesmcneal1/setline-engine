// set.Line desktop app: every native function and event the web UI uses.
// Functions take one JSON string and complete with one JSON string (see ui/src/bridge.ts).
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>
#include "SessionFile.h"
#include "Media.h"

namespace setline::gui {

class AudioHost;

class Bridge {
public:
    using Options = juce::WebBrowserComponent::Options;

    Bridge(AudioHost& host, juce::PropertiesFile& settings);
    ~Bridge();

    Options addTo(Options o);
    void attach(juce::WebBrowserComponent* b) { browser = b; }
    void emit(const juce::Identifier& event, const juce::var& payload);

    bool devMode = false;
    // Test: --session-roundtrip <in> <out> opens <in> in the page, saves it to <out> and quits.
    juce::File roundTripIn, roundTripOut;
    // Test: --test-script <in.js> <out.json> runs a script in the Edit page (see ui/src/pages/arrange.ts),
    // writes what it returns and quits. No dialogs, keyboard or mouse needed.
    juce::File testScript, testOut;

    // The page reports the session's name and whether it has unsaved changes (window title, quit check).
    std::function<void(const juce::String& name, bool dirty)> onDocument;
    bool isDirty() const { return dirty; }

    // Files dragged onto the window (the web view hands the page no paths, so the window takes the drop).
    // state: "over" | "leave" | "drop"; x, y in page pixels.
    void fileDrag(const juce::String& state, juce::Point<int> at, const juce::StringArray& paths = {});
    juce::File sessionFile() const { return session.file(); }

private:
    using Fn = std::function<juce::var(const juce::var&)>;
    static Options add(Options o, const char* name, Fn fn);
    using AsyncFn = std::function<void(const juce::var&, std::function<void(juce::var)>)>;
    static Options addAsync(Options o, const char* name, AsyncFn fn);

    AudioHost& audio;
    juce::WebBrowserComponent* browser = nullptr;
    SessionFile session;
    Media media;
    bool dirty = false;
};

} // namespace setline::gui
