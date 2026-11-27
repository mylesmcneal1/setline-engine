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
    // 13: a clip moved onto a track from another one plays its own file as an extra engine stem, named
    // "<track><n>": it follows that track's level, mute and solo (trackOf gives the track).
    static juce::String trackOf(const juce::String& engineName) { const int i = engineName.indexOfChar((juce::juce_wchar) 1); return i < 0 ? engineName : engineName.substring(0, i); }
    std::map<juce::String, int> engineTrack;   // Edit-page track name -> Engine track (ClickTrack, CueTrack, stem index)
    std::map<juce::String, TrackLevel> levels; // per track, from the song's mixer (gain / mute / solo)
};

// payload: { song: <one song from the Edit page>, sessionFile: <the open .setline> (audio references are
//            relative to its folder; added by the Bridge), outs: { trackName: [outputs, 1-based] } (the show's
//            routing by track name, or this song's override), cueVoice: {voice, name, speed} (the show's
//            cue voice; a song's own s.cueVoice wins), roles: { trackName: role } (finds the
//            click and cue tracks), click: <click settings in use> }
// resolvePort: Edit-page MIDI port name -> index of an opened MIDI output (-1 = not available).
MappedSong mapSong(const juce::var& payload, double sampleRate, int numOutputs,
                   const std::function<int(const juce::String&, std::vector<std::string>&)>& resolvePort,
                   // Spoken cues: text + the saved voice choice {voice, name, speed} -> audio at sampleRate
                   // (rendered ahead of time, see Cues.h). Empty = cues are skipped.
                   const std::function<std::shared_ptr<const std::vector<float>>(const juce::String& text, const juce::var& voice, std::vector<std::string>& warnings)>& cueAudio = {});

} // namespace setline::gui
