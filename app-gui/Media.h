// set.Line desktop app: audio files on disk for the session (step 2).
//
// - probe: reads a file's header (channels, rate, length, format) and says whether set.Line can play it
//   at the session's rate. Never resamples: a file at another rate is refused with the reason.
// - references: a session stores audio paths relative to its folder ("Audio/Drums.wav", always with
//   forward slashes), so a show folder can move between computers and between Windows and macOS.
//   Files outside the folder are stored as absolute paths.
// - copy: imported files are copied into <session folder>/Audio on a background thread, with progress
//   events ("audioProgress") for the page. An unsaved session keeps absolute paths until its first save.
// - missing files: lists what can't be found (trying <folder>/Audio/<name> first) and locates the rest
//   from one file the user points at (others in that folder are matched by name).
// Message thread only; copying happens on a worker thread and reports back on the message thread.
#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <functional>

namespace setline::gui {

class Media {
public:
    using Done = std::function<void(juce::var)>;
    using Emit = std::function<void(const juce::Identifier&, const juce::var&)>;

    explicit Media(juce::PropertiesFile& settings);
    ~Media();

    Emit emit;

    // {path, name, ok, channels, rate, frames, seconds, format, bits, error?}
    juce::var probe(const juce::File& f, double sessionRate);
    // {rate, multiple} -> {files: [probe...]} | {cancelled}
    void pick(const juce::var& arg, Done done);
    // {paths, rate} -> {files: [probe...]}
    juce::var probePaths(const juce::var& arg);
    // {session: path|"", copy, files: [path]} -> {files: [{path, ref}]} | {error}
    void import(const juce::var& arg, Done done);
    // Before saving to `to` (from `from`, "" if never saved): copies files flagged copy into <to folder>/Audio
    // and rewrites every reference relative to the new folder.
    // {from, to, files: [{ref, copy}]} -> {map: {oldRef: newRef}, missing: [ref]} | {error}
    void collect(const juce::var& arg, Done done);
    // {session, refs: [ref]} -> {missing: [ref], map: {ref: newRef}}  (map = found in <folder>/Audio)
    juce::var check(const juce::var& arg);
    // {session, missing: [ref]} -> chooser -> {map: {ref: newRef}} | {cancelled}
    void locate(const juce::var& arg, Done done);

    // Resolves a stored reference against a session file ("" = no session: absolute paths only).
    static juce::File resolve(const juce::String& ref, const juce::File& sessionFile);
    // How a file is stored in a session saved at sessionFile.
    static juce::String makeRef(const juce::File& f, const juce::File& sessionFile);

    static bool isAudioFile(const juce::File& f);
    static constexpr const char* audioWildcard = "*.wav;*.wave;*.aif;*.aiff;*.flac";

private:
    struct Job;
    void runJob(std::unique_ptr<Job> job);
    juce::File startFolder() const;

    juce::PropertiesFile& settings;
    juce::AudioFormatManager formats;
    std::unique_ptr<juce::FileChooser> chooser;
    std::unique_ptr<juce::Thread> worker;
    std::shared_ptr<bool> alive = std::make_shared<bool>(true);
};

} // namespace setline::gui
