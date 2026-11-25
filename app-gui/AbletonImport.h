// set.Line desktop app (7b): reads an Ableton Live project (.als: gzipped XML; Live 10, 11, 12) and works out the
// songs in it, ready for the Library: tempo map (bar lines exactly where Live has them), meters, sections from
// locators, audio tracks (arrangement clips, by file), MIDI tracks (notes, Bank + Program, CC envelopes). Nothing is
// copied or changed here, and the project is only read. What it does and doesn't bring in: docs/ableton-import.md.
#pragma once
#include <juce_core/juce_core.h>

namespace setline::gui::ableton {

struct Options {
    // auto: AbleSet's locator notation if the project uses it (">" sections, STOP / SONG END), else one song
    // ableset | single (one song, locators are sections) | each (every locator starts a song) | plus ("+Name" starts
    // a song, other locators are sections)
    juce::String mode = "auto";
    juce::StringArray midiPorts; // set.Line's MIDI outputs, to match each MIDI track's output by name
};

// The project as songs: {project, live, mode, songs: [...], ignored: [...], missing: [...], warnings: [...]}.
// Each song: {name, startBeat, endBeat, seconds, total (bars), tmap: [{bar, bpm, sig}], secs: [{name, type, start,
// bars, end}], tracks: [{name, kind, col, gainDb, mute, file: {path, found, bytes, name}, clips: [{start, end, off,
// gain, fi, fo, mute}], stretched, midi: {port, ch, events: [...]}}], warnings: [...]}.
// Times in a song are seconds from its start; bars from 1. Errors (not a Live project, unreadable): error set.
juce::var read(const juce::File& als, const Options& opts, juce::String& error);

// "Locate…": the files named in `names` (file names), searched for in `folder` and below. {name: full path}.
juce::var locate(const juce::File& folder, const juce::StringArray& names);

// --ableton-test: writes synthetic projects + tiny WAVs to dir, imports them, checks the results. Report lines
// ("ok ..." / "FAIL ..."), last line ABLETON OK or ABLETON FAILED.
juce::StringArray selfTest(const juce::File& dir);

} // namespace setline::gui::ableton
