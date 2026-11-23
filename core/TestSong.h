// Generates a test song: stems, a timing marker, a click, a tempo map with meter and tempo
// changes, and MIDI program changes plus a note on every bar for loopback timing checks.
#pragma once
#include "Song.h"
#include <string>
#include <vector>

namespace setline {

struct InMemorySource : SampleSource {
    std::vector<std::vector<float>> data; double sr = 48000;
    int numChannels() const override { return (int) data.size(); }
    int64_t length() const override { return data.empty() ? 0 : (int64_t) data[0].size(); }
    double sampleRate() const override { return sr; }
    bool read(float* const* dest, int64_t start, int n) override
    {
        for (size_t c = 0; c < data.size(); ++c)
            for (int i = 0; i < n; ++i) { const int64_t s = start + i; dest[c][i] = (s >= 0 && s < length()) ? data[c][(size_t) s] : 0.0f; }
        return true;
    }
};

// Layout of the test song (0-based outputs): music stems -> 0/1, "Marker" -> 2, click -> 3.
// MIDI: program changes at bars 1, 9, 10, 17 (ch 1) and a probe note (C4, ch 16) on every downbeat.
std::vector<TempoChange> testTempo();
SongDef makeTestSong(int musicStems, double seconds, double sampleRate, int midiPort = 0);

// Writes the WAVs and song.json into dir (created if needed). Returns "" or an error.
std::string writeTestSong(const std::string& dir, int musicStems, double seconds, double sampleRate);

// Offline self-test of the core (no audio device). Prints a report; returns true if every check passes.
bool runSelfTest(bool verbose);

} // namespace setline
