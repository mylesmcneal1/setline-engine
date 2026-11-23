// set.Line desktop app: turns the Edit page's song model (JSON from ui/1-arrange.html) into the
// engine's SongDef. See docs/step1-app-shell.md, "Song mapping".
#pragma once
#include <juce_core/juce_core.h>
#include "../core/Song.h"
#include <functional>
#include <map>
#include <string>
#include <vector>

namespace setline::gui {

struct TrackLevel { float db = 0; bool mute = false, solo = false; };

struct MappedSong {
    SongDef def;
    std::vector<std::string> warnings;
    std::map<juce::String, int> engineTrack;   // Edit-page track name -> Engine track (ClickTrack, CueTrack, stem index)
    std::map<juce::String, TrackLevel> levels; // per track, from the song's mixer (gain / mute / solo)
};

// payload: { song: <one song from the Edit page>, routing: { role: [outputs, 1-based] },
//            roles: { trackName: role }, click: <click settings in use> }
// resolvePort: Edit-page MIDI port name -> index of an opened MIDI output (-1 = not available).
MappedSong mapSong(const juce::var& payload, double sampleRate, int numOutputs,
                   const std::function<int(const juce::String&, std::vector<std::string>&)>& resolvePort);

} // namespace setline::gui
