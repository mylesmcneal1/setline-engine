// set.Line desktop app: every native function and event the web UI uses.
// Functions take one JSON string and complete with one JSON string (see ui/src/bridge.ts).
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>
#include "SessionFile.h"
#include "Media.h"
#include "Peaks.h"
#include "Cues.h"

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
    bool copyingAudio() const { return media.copying(); }
    void cancelAudioCopies() { media.cancelCopies(); }
    // Quitting with unsaved changes: the page asks Save / Don't save / Cancel ("menu" {cmd: "quit"}) and calls
    // quitNow when it's done; onQuitAnswered tells the app the page is handling it.
    std::function<void()> onQuitAnswered;
    // Start-up (the loading window, Splash.h): the page reports its steps ({id: show | waveforms | cues, state:
    // running | done | failed, detail, fraction}) and when it's ready. File drops are ignored until then.
    std::function<void(const juce::var&)> onLoadingStep;
    std::function<void()> onLoadingDone;
    bool loading = true;

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
    Peaks peaks;
    Cues cues;
    std::map<juce::String, juce::String> cueErrors; // from the last song load: cue text -> why it couldn't be spoken
    void withCues(const juce::var& payload, std::function<void()> then);
    Cues::Choice choiceOf(const juce::var& v, juce::String* missingRecording = nullptr) const;
    void syncShow();
    juce::String diagnostics();
    std::unique_ptr<juce::FileChooser> diagChooser;
    Options addRest(Options o);
    void preparePeaks(const juce::var& refs, const juce::File& sessionFile);
    bool dirty = false;
    std::shared_ptr<Bridge*> alive = std::make_shared<Bridge*>(this); // cleared on destruction (async callbacks)
};

} // namespace setline::gui
