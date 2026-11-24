// set.Line desktop app: waveform peaks for the session's audio files (step 2).
//
// - Computed on background threads when a file is imported or a session is opened, and on demand when
//   the page asks for a file that isn't ready yet (those requests go first).
// - One value per block of frames: the largest absolute sample over all channels, stored as one byte on
//   a square-root scale (quiet passages keep some resolution): value = (byte / 255)^2.
// - Levels: 256, 1024 and 4096 frames per value. The page asks for the one that fits its zoom.
// - Cached next to the audio as "<file>.peaks" (or in the app's data folder if that folder can't be
//   written), and checked against the audio's size and date, so a changed file is read again.
// - Sent to the page as base64 (one level of one file per call), so opening a session with many stems
//   only moves what the page draws.
// Callbacks run on the message thread.
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>
#include <deque>
#include <map>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <functional>

namespace setline::gui {

class Peaks {
public:
    static constexpr int levels[] = { 256, 1024, 4096 };
    static constexpr int numLevels = 3;

    struct Data {
        double rate = 0;
        juce::int64 frames = 0;
        int channels = 0;
        juce::MemoryBlock level[numLevels];
    };
    using Ready = std::function<void(std::shared_ptr<const Data>, const juce::String& error)>;

    Peaks();
    ~Peaks();

    // Page request: first in the queue. Calls back on the message thread.
    void get(const juce::File& audio, Ready done);
    // Import / open: computed in the background (after any page requests) so they're ready when drawn.
    void prepare(const juce::Array<juce::File>& audio);

    // {rate, frames, spp, peaks: base64} for one level, picked by frames per value.
    static juce::var toVar(const Data& d, int spp);

    // Reads (or computes and caches) the peaks of one file. Any thread.
    static std::shared_ptr<const Data> load(const juce::File& audio, juce::AudioFormatManager& formats, juce::String& error,
                                             bool* fromCache = nullptr);
    static std::shared_ptr<Data> compute(const juce::File& audio, juce::AudioFormatManager& formats, juce::String& error);
    static juce::File cacheFileFor(const juce::File& audio);

private:
    void run();
    void finish(const juce::String& path, std::shared_ptr<const Data> d, const juce::String& error);

    std::mutex lock;
    std::condition_variable wake;
    std::deque<juce::File> queue;
    std::map<juce::String, std::vector<Ready>> waiting;   // message thread
    std::map<juce::String, std::shared_ptr<const Data>> memo; // message thread
    std::vector<std::thread> threads;
    bool quit = false;
    std::shared_ptr<bool> alive = std::make_shared<bool>(true);
};

} // namespace setline::gui
