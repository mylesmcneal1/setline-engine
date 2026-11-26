# The click as a MIDI clip, versions with their own timeline, sections from cues (10c)

Code: `ui/public/click10.js` (the click clip and its editor), `ui/public/vers10.js` (versions, merge, the import's
suggestions), `ui/public/secs10.js` (sections from cues), `c10.css`; `app-gui/SongMapper.cpp` (a note's velocity),
`app-gui/AbletonImport.cpp` (Live's exact click positions and velocities). Tests: `tests/ui-10c.js` (Chrome and
WebKit), the core test (click notes in mixed meters on exact samples). Mockup: `docs/design/phase10/c1-click.png`.

## The click
- **A Click track holds one MIDI clip with two lanes:** **Accent** (C3: the accent sound) and **Click** (C#3: the
  normal click). A note has a position (ticks, 960 to a quarter note, from the song's start), a length (only drawn)
  and a velocity (its level). A Drum click track works the same way with its own sounds.
- **Playback:** the notes are the click, sample-exact, through the same click engine, sounds, outputs and levels
  (Accent level, Beat level, Off-beats). Velocity scales the level on top: 40·log10(v/127) dB (127 = as before).
  Count-ins stay generated.
- **The lane** on the timeline shows the two rows (accents white, clicks yellow). Clicking it opens the clip editor.
- **The clip editor** (a panel under the timeline; drag its top edge to resize): the two named rows, a grid (1/4 ·
  1/8 · 1/16 · Triplet) with bar lines and the time signatures, Draw (click to add, click a note to remove, drag to
  paint) and Select (box select, drag to move, ⌥-drag to copy, ⌘D duplicate, ⌫ delete, ⌘C / ⌘V, ⌘A), a velocity
  strip (drag the bars), and the timeline's own position and zoom (scrolling or ⌥-scrolling here moves both).
  Buttons: **Fill from time signature** (the whole song or the selection: an accent on beat 1, or on each group's
  start in an odd meter such as 7/8 as 2+2+3, a click on the other beats), **Pattern ▾** (quarters, 8ths, 16ths,
  triplets, half-time over the selection or the bars on screen), ⋯ › Clear · Refill from time signature.
  Keys D / S switch Draw / Select.
- **The click stays exactly as drawn.** A tempo or time signature change never rewrites it; the lane and the editor
  say "Time signature changed: Refill click?" (Refill, or Keep as drawn).
- **A new song** (and a new click track) starts filled from its time signature.
- **Existing songs:** their click clips become notes with no audible change (velocity 127, the same positions,
  accents and levels; tested on every song). The old clips stay in the song file, so an older set.Line (a
  rollback) still plays a click.
- **Ableton:** Live's CLICK / DRUM CLICK notes go straight into the lanes: the accent notes (MetronomeUp, or the
  loudest on beat 1, as 8b decides) on Accent, the rest on Click, velocities kept. A note more than a tick off the
  16th grid is moved onto it (8b); one within a tick stays where it is.

## Versions with their own timeline (merge songs as versions)
- A version can now have **its own timeline**: its own tracks and audio, tempo map, time signatures, sections, click
  clip and cues. It's still the same song (name, colour, fields, presets). The Versions ▾ picker lists both kinds;
  the version strip marks these "own timeline".
- **At import (step 2 of the Ableton window):** a song whose name is another's plus variant words (EXT, EXTENDED,
  INTRO, EXTENDED INTRO, ALT, ALTERNATE, ACOUSTIC, SHORT, RADIO, EDIT, LIVE, V2, (2)) is suggested: "Merge GARDEN
  (EXTENDED INTRO) into GARDEN as a version named Extended intro", ticked. Untick it, pick another main song, or
  rename the version.
- **In the library:** select two or more songs › **Merge as versions…** (Library menu, the selection's right-click
  and ⋯, ⌘K): pick the main song; the others become its versions. **Unmerge version** (shown version) makes it a
  song again. Undo works for both.
- **Setlists:** a setlist that had the merged song now plays the main song with that version, so nothing changes in
  what plays. A setlist that has both (Live's own arrangement does, as Live has no versions) keeps the main song
  once, at the first of the two places; the other version is one ‹ › away, and the summary says so.
- **Audio:** the library stores every file once by its content, so versions using the same files share them.
- Playing a version that isn't shown switches the song view to it (what plays is what you see).

## Make sections from cues
- **Where:** the Sections row header (**From cues**), an empty Sections lane in a song with section cues (ghost
  sections with **Make these N sections** and **Edit…**), Song › Make sections from cues…, the right-click menus on
  the Sections row and on a song, the selection bar (✨ Sections from cues), ⌘K. Several songs at once from the
  selection's menu (a song with sections keeps them and gets the gaps filled). After an Ableton import, the summary
  offers "Make sections from cues for N songs".
- **Edit…:** the sections (a tick and an editable name each, a strip to see them), the cue words found with "counts
  as a section" ticks (Intro, Verse…, Pre / Prechorus, Chorus, Bridge, Breakdown, Solo, Outro, Ending, Tag,
  Interlude, Drop, Vamp by default), count-ins skipped ("One, Two…", numbers, "Go"), and with sections already
  there: **Replace my sections** or **Keep my sections and fill the gaps**. Undo works.
