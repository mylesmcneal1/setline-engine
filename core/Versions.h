// set.Line — song versions (phase 6e).
// A song has one source arrangement (its stems, clips, tempo map, click, cues and MIDI). A version plays parts of it
// laid end to end: runs of source bars (its sections, skipped or reordered) and version-only parts (bars with no
// source audio, e.g. an intro pad on its own track). Every version uses the same stem files; nothing is copied.
//
// applyVersion builds the SongDef the engine plays:
//  - the tempo map: each part starts with the source's tempo and meter at its first bar, then the source's changes
//    inside it, at the version's bar numbers;
//  - stems: every clip is cut to the parts and moved to the version's timeline (whole samples, never resampled or
//    stretched); the clip's own gain and fades stay where they were (ClipDef::envStart / envEnd);
//  - joins: parts that are contiguous in the source are merged first, so there is no join at all between them; where
//    two parts aren't contiguous, a short equal-power crossfade centred on the join sample (default 5 ms): the part
//    before plays on through half of it, the part after starts half of it early (ClipDef::xOut / xIn);
//  - click hits, cues and MIDI events follow their bars; anything in a skipped bar is left out.
// The last part keeps the source's tail (the audio after the song's last bar, e.g. a ringing chord) when it ends where
// the source ends. A version that starts after bar 1 fades in over the crossfade length; one that ends early fades out.
#pragma once
#include "Song.h"
#include <string>
#include <vector>

namespace setline {

struct VersionPart {
    int bar = 1, bars = 0;   // source bars [bar, bar + bars); bar < 1: a version-only part (no source audio)
    double bpm = 0;          // a version-only part's tempo and meter (0: the next part's, or the previous part's at its end)
    int num = 0, den = 0;
    int tag = -1;            // the caller's id for this part (kept by the part it's merged into)
};

struct VersionDef {
    std::vector<VersionPart> parts;
    double crossfadeMs = 5;
};

// Where each part landed (after contiguous parts were merged).
struct VersionLayout {
    struct Part { int srcBar = 1, verBar = 1, bars = 0; bool extra = false; int tag = -1; int64_t verStart = 0, verEnd = 0, srcStart = 0; };
    std::vector<Part> parts;
    int64_t crossfade = 0;   // samples, centred on each join
    bool tail = false;       // the last part keeps the source's audio after its last bar
};

SongDef applyVersion(const SongDef& src, const VersionDef& v, double sampleRate, std::vector<std::string>& warnings,
                     VersionLayout* layout = nullptr);

} // namespace setline
