// set.Line desktop app: every native function and event the web UI uses.
// Functions take one JSON string and complete with one JSON string (see ui/src/bridge.ts).
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>
#include "SessionFile.h"
#include "Media.h"
#include "Peaks.h"
#include "Cues.h"
#include "LibraryStore.h"
#include "BandServer.h"
#include "MidiControl.h"
#include "RigLink.h"
#include <atomic>
#include <thread>

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
    bool reopenLast = true;      // start-up reopens the last show (test runs only with --reopen-last)
    bool startShowTaken = false;
    bool reopenLastInTests = false; // ... once per run (pages reload when switching tabs)

    // The page reports the session's name and whether it has unsaved changes (window title, quit check).
    std::function<void(const juce::String& name, bool dirty)> onDocument;
    std::function<void(const juce::var& spec)> onMenus; // 9c: the page's menus for the window chrome
    std::function<bool(const juce::String& id)> onMenuChoose; // 10b tests: choose an item as the menu bar does
    std::function<void(bool on)> onTextFocus; // 10b: a text field has focus (the Mac's Edit menu edits text then)
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
    juce::PropertiesFile& settings; // (Preferences: the Shows folder)
    juce::String updToken(); // 15 §13: the GitHub token for a private repository (Keychain / Credential Manager)
    juce::File updStaged;            // 8d: an update downloaded, verified and unpacked next to the app
    juce::var pedalArmV;             // 8d: what a pedal can do natively right now (the page keeps it current: pedalArm)
    int fastCount = 0; double fastMax = 0, fastSum = 0; juce::String fastWorst;
    juce::var pedalFast(const juce::String& action, bool press, double t0);
  public:
    // 8d: crash recovery's state (resumeSave / resumeGet); markStopped() on a normal quit
    juce::File resumeFile() const { return settings.getFile().getSiblingFile("resume.json"); }
    void markStopped() { auto v = juce::JSON::parse(resumeFile().loadFileAsString()); if (auto* o = v.getDynamicObject()) { o->setProperty("playing", false); resumeFile().replaceWithText(juce::JSON::toString(v, true)); } }
  private:
    SessionFile session;
    Media media;
    Peaks peaks;
    Cues cues;
    LibraryStore lib;
    BandServer band; // 6g: the band screens
    MidiControl midiControl { settings }; // 7c: footswitches / controllers
    double midiActMax = 0; int midiActCount = 0;
    RigLink rig { settings }; // 7d: the backup rig
    juce::var rigLib;         // backup: its library list (from the page) for the primary's match check
    std::thread rigSender;
    void rigMute();
    std::thread exporter;                    // writing a .setline package (one at a time)
    std::shared_ptr<std::atomic<bool>> exportCancel = std::make_shared<std::atomic<bool>>(false);
    juce::var libraryOpened(const juce::var& r);
    std::map<juce::String, juce::String> cueErrors; // from the last song load: cue text -> why it couldn't be spoken
    // wait = false (loading a song for Play, 14 §3): never waits for speech; words not rendered yet are left out, render in
    // the background and join the loaded song (updateLive) when ready, unless it was reloaded or edited since
    void withCues(const juce::var& payload, std::function<void()> then, bool wait = true);
    int liveSeq = 0;                  // 14 §3: bumped by every load and live update
    juce::StringArray pendingCues;    // words a load went ahead without (no "couldn't be spoken" warning for them)
    juce::String lateCueInfo;         // Diagnostics: the last cue that joined late or was skipped
    Cues::Choice choiceOf(const juce::var& v, juce::String* missingRecording = nullptr) const;
    void syncShow();
    juce::String diagnostics();
    double cueRate() const;
    Options addRest(Options o);
    void preparePeaks(const juce::var& refs, const juce::File& sessionFile);
    bool dirty = false;
    std::shared_ptr<Bridge*> alive = std::make_shared<Bridge*>(this); // cleared on destruction (async callbacks)
    juce::String uiTiming; // 9b: the page's Show timing summary, for Diagnostics
};

} // namespace setline::gui
