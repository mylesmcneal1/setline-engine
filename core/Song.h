// Song description handed to the engine. Pure data; loading from song.json lives in the app layer.
#pragma once
#include "Clip.h"
#include "TempoMap.h"
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace setline {

// Anything that can deliver audio frames: a JUCE file reader in the app, a WAV in memory in tests.
// read() is only ever called from the disk thread.
struct SampleSource {
    virtual ~SampleSource() = default;
    virtual int numChannels() const = 0;      // 1 or 2
    virtual int64_t length() const = 0;       // frames
    virtual double sampleRate() const = 0;
    virtual bool read(float* const* dest, int64_t start, int numFrames) = 0;
};

struct StemDef {
    std::string name;
    std::shared_ptr<SampleSource> source;
    std::vector<int> outs; // 0-based device output channels (1 or 2 entries)
    float gainDb = 0;
    // The clips on this track (step 2). Not set: the whole file from sample 0 (step 1, the test song).
    // Set but empty: a track with no clips, silent.
    std::optional<std::vector<ClipDef>> clips;
};

struct MidiEventDef {
    int port = 0;          // index into the app's opened MIDI outputs (-1 = unresolved, skipped)
    int bar = 1;
    double beat = 1;
    uint8_t bytes[3] { 0, 0, 0 };
    int len = 0;
    std::string label;
    double earlySeconds = 0; // send this much before its bar/beat (e.g. so a preset is loaded by the downbeat)
};

// One click the user entered (a note in a click clip). Bar is 1-based, beat 1-based and may be fractional.
struct ClickHitDef {
    int bar = 1;
    double beat = 1;
    bool accent = false;
    float gainDb = 0;      // per-hit level on top of the click track level (e.g. quieter subdivisions)
};

struct SongDef {
    std::string name;
    std::vector<TempoChange> tempo;
    std::vector<StemDef> stems;
    std::vector<int> clickOuts; // 0-based; empty = no click
    float clickGainDb = -6;
    // When set, the engine plays exactly these click hits and generates nothing else (even if empty).
    // When not set, it clicks every beat (the test song and the spike).
    std::optional<std::vector<ClickHitDef>> clickHits;
    std::vector<MidiEventDef> midi;
    // The song lasts at least this many bars (0 = as long as its stems / tempo map / content say).
    int lengthBars = 0;
};

} // namespace setline
