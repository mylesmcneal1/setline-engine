// Song description handed to the engine. Pure data; loading from song.json lives in the app layer.
#pragma once
#include "TempoMap.h"
#include <cstdint>
#include <memory>
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
};

struct MidiEventDef {
    int port = 0;          // index into the app's opened MIDI outputs (-1 = unresolved, skipped)
    int bar = 1;
    double beat = 1;
    uint8_t bytes[3] { 0, 0, 0 };
    int len = 0;
    std::string label;
};

struct SongDef {
    std::string name;
    std::vector<TempoChange> tempo;
    std::vector<StemDef> stems;
    std::vector<int> clickOuts; // 0-based; empty = no click
    float clickGainDb = -6;
    std::vector<MidiEventDef> midi;
};

} // namespace setline
