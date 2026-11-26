# Phase 10c · Click as a MIDI clip, merge songs as versions, sections from cues

Mockup: `docs/design/phase10/c1-click.png` (the user: "that's exactly what I want!").

## 1. The click becomes an Ableton-style MIDI clip
**The model:**
- A Click track holds a **MIDI clip with two lanes:**
  - **Accent** (note C3, plays the accent sound)
  - **Click** (C#3, plays the normal click sound)
- **Each note** has a position (ticks), a length (cosmetic) and a velocity (= level).
- **The existing click sounds and outputs stay.** A Drum click track works the same way with its own sounds.

**Playback:** the generated click (6x/7a) is replaced by playing these notes, sample-accurate, through the same click engine. Count-ins stay generated, as now. Velocity scales the click level, and the existing click level/output controls still apply.

**The timeline:** the Click track lane shows the two rows of notes (accent white, click yellow). Clicking it opens the **clip editor** underneath (a resizable bottom panel), as in the mockup.

**The clip editor:**
- **Two named rows** with their note names.
- **Grid:** 1/4 · 1/8 · 1/16 · Triplet (it follows the time signature map from 9a; bar lines and meter labels are drawn on the grid).
- **Draw mode:** click to add, click a note to remove, drag to paint.
- **Select mode:** marquee select, move, ⌥-drag to copy, ⌘D duplicate, ⌫ delete, copy/paste.
- **A velocity strip** underneath, with draggable bars.
- **Zoom and scroll** linked to the song timeline (one shared position, as in 9e).
- **Buttons:**
  - **Fill from time signature:** whole song or selection. Writes an accent on beat 1 (or on each group start in odd meters, from 9a grouping) and a click on the other beats.
  - **Pattern ▾:** fills the selection with quarters, 8ths, 16ths, triplets or half-time.
  - ⋯ menu: Clear · Refill from time signature.

**Behaviour (the user's choice):** a new song's click starts filled from its time signature. After that, **the click stays exactly as drawn.** Changing the tempo map or meter never rewrites it; "Refill from time signature" does it on request (whole song or selection). If the meter changes under existing notes, show a one-line hint: "Time signature changed: Refill click?"

**Migration:** existing songs' generated clicks become clips filled from their current time signature map, with no audible change. Converted Ableton click tracks (8b) go straight into the lanes.

**Ableton import:** Live's CLICK / DRUM CLICK MIDI notes map into the lanes: MetronomeUp (or the highest-velocity note per bar, as 8b decided) → **Accent**, everything else → **Click**. Velocities are kept. The 16th-grid snapping from 8b only applies when a note is more than 1 tick off.

**Band screens and the beat lights** follow the actual notes (an accent lights beat 1).

**Tests:** playback timing of the notes (sample-accurate), mixed meters, fill and refill, patterns, migration with no audible change, and the import mapping.

## 2. Merge songs as versions
Live has no versions, so "GARDEN" and "GARDEN (EXTENDED INTRO)" come in as two songs. The same goes for PROXIMA II and PROXIMA II (EXTENDED INTRO).

**A version can have its own timeline.** Today (6e) versions are made from sections of the main arrangement. Add a second kind: a version with **its own timeline** (its own tracks/audio, tempo map, meter map, sections, click clip and cues). It's still the same song: same name, colour, fields, presets and band-screen notes. The Versions ▾ picker lists both kinds.

**At import (the 9a Sort step):**
- **Detect variants:** a song whose name is another song's name plus a variant word, case-insensitive: `EXT`, `EXTENDED`, `INTRO`, `EXTENDED INTRO`, `ALT`, `ALTERNATE`, `ACOUSTIC`, `SHORT`, `RADIO`, `EDIT`, `LIVE`, `V2`, `(2)`.
- **Suggest:** "Merge GARDEN (EXTENDED INTRO) into GARDEN as a version", ticked by default. The user can untick it or pick a different main song. The version name defaults to the leftover words in title case ("Extended intro") and can be edited.

**In the library:**
- **Select two or more songs** (select mode or the Library menu) and choose **Merge as versions…**. Pick the main song; the others become versions with their own timelines.
- **Unmerge version** turns a version back into its own song.
- **Undo** works.

**Setlists:** a setlist that contained the merged song now points to main song + that version, so nothing changes in what plays.

**Storage:** if versions use the same audio files (same hash), store them once.

**Re-test** on the real project into a TEST library only (read-only on the drive): GARDEN + GARDEN (EXTENDED INTRO) and PROXIMA II + PROXIMA II (EXTENDED INTRO) should be suggested and merged. Report what was suggested and the audio shared.

## 3. Make sections from cues, front and centre
Today this is only an option in the right panel when a song is selected.

**Where it shows:**
- **The Sections row header:** a **"From cues"** button next to +.
- **An empty Sections lane** in a song that has cues: ghost sections (dashed blocks with names) plus **"Make these N sections"** / **"Edit…"** right in the lane (ix1 item 5).
- **Menus:** Song › Make sections from cues… · the right-click menus on the Sections row and on a song · ⌘K.
- **Many songs at once:** select songs, then Make sections from cues (in the selection bar and the Song menu).
- **After an Ableton import:** for songs without sections, a single "Make sections from cues for N songs?" in the import summary.

**The preview/editor (Edit…):**
- **Ghost blocks** on the timeline with a checkbox and an editable name each.
- **Count words** ("One, Two, Three, Four…", numbers, "Go") are skipped automatically.
- **A list of the cue words** found, with "counts as a section" ticks. Defaults: Intro, Verse…, Pre/Prechorus, Chorus, Bridge, Breakdown, Solo, Outro, Ending, Tag, Interlude, Drop, Vamp.
- **Replace my sections** or **Keep my sections and fill the gaps.**
- **Undo** works.

Reuse the 8b logic (sections start at the cue's bar); this is about making it visible and easy.

**Tests:** the ghost suggestion appears when cues exist and sections don't; accepting makes the right sections; count words are skipped; the batch works across several songs; undo.
