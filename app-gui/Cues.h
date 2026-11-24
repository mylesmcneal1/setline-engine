// set.Line desktop app: spoken cues rendered ahead of time (step 2).
//
// - Every cue is rendered once with the chosen voice and speed (Speech.h) and cached by text + voice +
//   speed + sample rate: in memory, and on disk in the app's cache folder (Cache/Cues). Never during
//   playback: the page asks for the session's cues while you edit (prepare), and loading a song only
//   picks them up (rendering the odd one that isn't ready yet).
// - Rendered speech is resampled once, at render time, to the show's rate (the one allowed exception
//   to "never resample": it is generated material, not a user's stem). Leading silence is trimmed, so
//   the first word starts on the cue's bar.
// - A cue whose text is one of the show's recorded words plays that recording instead (any rate, mono or
//   stereo: mixed to mono, resampled once, leading silence trimmed, like speech).
// - A voice that isn't installed here (a session made on another computer) falls back to the default
//   voice; the session keeps its choice.
// All speech runs on one worker thread; the public functions can be called from the message thread.
#pragma once
#include <juce_core/juce_core.h>
#include <condition_variable>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>
#include "Kokoro.h"
#include "Speech.h"

namespace setline::gui {

class Cues {
public:
    using Audio = std::shared_ptr<const std::vector<float>>;
    // voice id + display name as saved, speed, and the show's pronunciations (Kokoro.h)
    // recording: a recorded cue word (full path) used instead of a voice (phase 7, part 2).
    struct Choice { juce::String voice, name; double speed = 1; kokoro::Pronunciations pron; juce::String recording; };
    // From the page's {voice, name, speed, pron: {word: sounds like}}.
    static Choice choiceFrom(const juce::var& v);
    // Why a choice falls back to the default voice: "" (it doesn't), "missing" or "notDownloaded" (Kokoro).
    juce::String fallbackReason(const Choice& c);
    // Words in these texts the dictionaries don't know (Kokoro voices; sounded out from spelling until the show says how
    // they sound). Calls back on the message thread.
    void checkWords(juce::StringArray texts, Choice c, std::function<void(juce::StringArray unknown, juce::String phonemes)> done);

    Cues();
    ~Cues();

    // [{id, name, lang, quality, engine, gender, grade, rank, isDefault}]: the built-in Kokoro voices, then the
    // computer's (listed once, then cached)
    juce::var voices();
    // The same, without blocking: calls back on the message thread.
    void voicesAsync(std::function<void(juce::var)> done);
    // The installed voice for a saved choice: its id, else a voice with the same name (ids differ between
    // computers), else "" = the default voice (fellBack = true when a voice was asked for).
    juce::String resolve(const Choice& c, bool& fellBack);

    // Renders whatever of these isn't cached yet (first in the queue), then calls back on the message
    // thread with an error per text that couldn't be spoken. Loading a song waits for this, never blocking.
    void ensure(std::vector<std::pair<juce::String, Choice>> list, double rate, std::function<void(std::map<juce::String, juce::String> errors)> done);
    // Already rendered audio (nullptr if not), without waiting. fellBack: the voice isn't installed here.
    Audio cached(const juce::String& text, const Choice& c, double rate, bool& fellBack);
    // Audio for one cue at `rate` (mono). Renders now if it isn't cached (waits up to 20 s; tests).
    Audio get(const juce::String& text, const Choice& c, double rate, juce::String& error, bool& fellBack);
    // Renders these in the background so they're ready before Play: [{text, voice, name, speed}].
    void prepare(const juce::var& list, double rate);
    // Renders and calls back on the message thread (Preview).
    void render(const juce::String& text, const Choice& c, double rate, std::function<void(Audio, juce::String error)> done);

    static juce::File cacheFolder();
    static juce::File cacheOverride; // tests: a fresh cache folder instead of the app's

private:
    struct Task { std::function<void()> fn; };
    void post(std::function<void()> fn, bool urgent);
    void run();
    Audio renderNow(const juce::String& text, const juce::String& voiceId, const Choice& c, double rate, juce::String& error); // worker
    juce::String keyOf(const juce::String& text, const juce::String& voiceId, const Choice& c, double rate) const;
    static bool readRecording(const juce::File& f, std::vector<float>& out, double& rate, juce::String& error); // worker
    void ensureVoices(); // worker
    juce::String resolveLocked(const Choice& c, bool& fellBack) const; // dataLock held

    std::mutex lock;
    std::condition_variable wake;
    std::deque<std::function<void()>> queue;
    bool quit = false;
    std::thread worker;

    std::mutex dataLock; // guards the members below
    std::map<juce::String, Audio> memo;
    std::vector<speech::Voice> installed;
    juce::String defaultId;
    bool listed = false;
    std::shared_ptr<bool> alive = std::make_shared<bool>(true);
};

} // namespace setline::gui
