# Phase 7b: Import Ableton Live projects

**Why:** the band's songs live in Ableton Live projects, used with AbleSet today. Rebuilding every song by hand is the biggest barrier to switching. Dropping in a `.als` file should produce ready-to-play songs in the Library.

**Rules that still apply:**
- **Never resample or time-stretch.** Audio comes in as-is.
- Audio is copied into the Library (fast copy, content-hash dedupe).
- Never modify the user's Ableton project or its files.

---

## 1. Reading `.als`

- A `.als` file is gzipped XML. Support Live 10, 11 and 12 projects.
- Parse it with a robust XML reader. Unknown elements are ignored, never fatal.
- **What to read:**
  - **Tempo:** the master tempo and its automation (tempo changes and ramps) → the song tempo map, using set.Line's one rounding rule.
  - **Time signature** changes → meter changes.
  - **Locators** (name + time) → sections. Use set.Line's section types where the name matches (Intro, Verse, Pre, Chorus, Bridge, Outro, Count-in…); otherwise type "Other" with the locator's name.
  - **Audio tracks, arrangement clips only:**
    - the sample file reference (handle absolute paths, relative paths, and the project's own folders: Samples/Imported, Samples/Recorded, Samples/Processed…)
    - clip start/end on the timeline, the sample start offset, loop on/off
    - clip gain, fades (as clip fades)
    - track volume (as a gain trim), track mute, track colour (map to the nearest palette colour)
    - track name
  - **Group tracks:** flatten them. Imported tracks keep the group name as a prefix, e.g. "Vox / BGV 1".
  - **Warping: set.Line can't stretch.**
    - If a clip is warped and its effective stretch ratio is 1.0 (the audio's tempo equals the arrangement tempo, or the warp markers imply no stretching), import it normally.
    - If it would need stretching, still import it, but flag the track: "This clip was time-stretched in Ableton. Bounce/export it at the song's tempo and replace the file." Show it in the import summary.
  - **MIDI tracks:**
    - arrangement MIDI clips: notes, the clip's Bank/Sub-bank/Program settings (sent at clip start as Bank Select + Program Change), and CC envelopes inside clips → MIDI events
    - the track's MIDI output → a set.Line MIDI port by name if one exists, otherwise unassigned with a warning
  - **Return/master effects, devices and plugins:** ignore them. set.Line is playback only. List them in the summary as "not imported".
- **Missing samples:** search the project folder, its parents up to 2 levels, and "Samples" subfolders by file name. Still missing → a list in the summary, with a "Locate…" button that searches a chosen folder.

## 2. Whole-set projects (AbleSet style)

- **Many users keep a whole set in one `.als`.** In AbleSet, songs are marked with locators, and AbleSet has naming conventions for song starts, stops and sections.
- **Before implementing,** read AbleSet's public documentation (ableset.app docs) and support its conventions. Write the rules you implemented into `docs/ableton-import.md`, with links to the source pages.
- Also support the simple cases:
  - **One song per project:** the project name is the song name, and the locators are sections.
  - **A locator naming scheme the user picks in the import dialog:** "Every locator is a song", or "Song locators start with +".
- Each detected song becomes its own Library song, made from the arrangement between its start and the next song's start (or a stop marker). It is shifted to start at bar 1, keeping the tempo map and meter that apply there.
- **Option: "Also create a setlist from this project"**, in arrangement order, named after the project.

## 3. Import UI

- Add **File → Import Ableton project…**. Dropping a `.als` onto the Library panel also works.
- **Preview dialog before anything is copied:**
  - the songs found (checkboxes, all ticked), with length, tempo and meter, and the number of sections, audio tracks and MIDI tracks
  - per song, expandable: the tracks with their proposed output (reuse the 6d default rule: same name → the same output used before; otherwise the next free output); warnings (stretched clips, missing samples, unmapped MIDI ports, ignored devices)
  - a duplicates check against the Library (by audio hash + name): "Skip / Import as new version / Import as new song"
  - an estimate of the audio size to copy
- **Import runs in the background** with progress and Cancel.
- **At the end, a summary,** with "Show in Library" and a log file saved next to the Library's migration logs.

## 4. Tests

Create small synthetic `.als` fixtures in the tests (gzipped XML written by the test itself, with tiny WAV files). They should cover:
- tempo changes and a ramp
- meter changes
- locators → sections
- an audio clip with an offset and fades
- a warped clip with ratio 1 (imported) and one with ratio ≠ 1 (flagged)
- a missing sample found in a sibling folder
- a MIDI clip with a program change and notes
- a group track
- a whole-set project split into 3 songs

**Round-trip check:** the import output's tempo map and section times match the fixture exactly.

## Done when

- The fixtures pass and CI is green.
- `docs/ableton-import.md` explains what is and isn't imported.
- **Ask the user in the final report** to try one real project from the band. They'll need to tell you where their Ableton projects are; don't go looking through their drives yourself.
