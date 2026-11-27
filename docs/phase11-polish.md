# Phase 11 · Edit anything, and a polish pass from testing 0.1.63 on the Mac

The user's screenshots from the band's 2015 MacBook (macOS 12, 1280×800) are in `docs/design/phase11/`:
- `version-arrows.png`: the ‹ › version arrows under the ⋯ button in a setlist row
- `rename-box.png`: renaming opens a floating box offset from the name
- `garden-sections-click.png`: GARDEN, with suggested sections, the click clip editor zoomed out, cues and audio tracks
- `sections-not-straight.png`: after "Make sections from cues", the sections stack on two lines

Everything must work in macOS 12's WebKit (test there in CI) and fit at 1280×800.

## 1. Delete click tracks
Click and Drum click tracks can be deleted like any other track: right-click › Delete track, ⌫ on a selected track, the ⋯ menu, Track › Delete track and ⌘K. Undo restores the track with its clip. Deleting the last click track is allowed: the song simply has no click, and the empty-lane suggestion offers "Add click track".

## 2. Edit or delete anything
The user: "I should be able to edit or delete anything." No more special or built-in items that can't be renamed, edited or deleted.
- **Audit every object:**
  - tracks (audio, click, drum click, cues, MIDI)
  - songs, versions (the main/Album version too, as long as another stays), sections, clips, markers
  - tempo and time-signature changes (bar 1 can be edited, not deleted)
  - setlists, breaks, libraries (not the one that's open), presets and scenes, cue words
  - anything that came from an Ableton import
- **Each object gets the same options** (rename where it has a name, edit, delete) in the same four places: right-click, ⋯, the menu bar and ⌘K. Undo works for all of them.
- **Deleting something used elsewhere** (a preset used by songs, a version in a setlist, a library) explains what will happen and asks first. Nothing else asks.
- **Report:** a list of everything that couldn't be edited or deleted before, and what changed.

## 3. Version arrows overlap the ⋯ button
In setlist rows the ‹ › version arrows sit under the ⋯ button (`version-arrows.png`).
- **Remove the ‹ › arrows from rows.** The version text ("Album · 4:24") becomes the switcher: click "Album ▾" to pick. Keep the dots showing how many versions there are. ⌥[ / ⌥] still switch.
- **The ⋯ button** gets its own space at the right edge.
- **Overlap audit:** check every row type (setlist songs and breaks, cards, Folders rows, track headers, section blocks, clip editor rows) for overlapping controls at 1280×800 and in every font pairing. Add a CI layout check that fails when interactive elements overlap.

## 4. Rename in place
Renaming opens a floating box offset from the name (`rename-box.png`).
- **The name itself becomes editable where it is:** same font, size and position, with the text selected. ↩ or clicking away saves; Esc cancels. The row must not move or resize.
- **Everywhere a name can be renamed:** setlist rows, cards, Folders rows, the song title, track headers, sections, breaks, setlist name, library name, scenes, cue words.
- **UI test:** the edit field's box matches the name's box within 2 px.

## 5. Remove the box around songs with versions
In the setlist, songs that have versions get a coloured outline whether or not they're playing. Remove it. "Album ▾" and the dots already show that a song has versions. Keep the real indicators: the playing song shows a green number and ▶, the selected song gets a lighter background, and keyboard focus is a thin grey ring.

## 6. Clearer suggested sections
In `garden-sections-click.png` the suggested sections (dashed) are hard to read as suggestions, and the "Make these 9 sections" / "Edit…" buttons cover the section names.
- **Ghost sections** use their section colours at low opacity, with a small "Suggested" tag on the first one.
- **The buttons move to a slim bar above the Sections row,** never on top of it: "9 sections suggested from your cues · Use them · Edit… · Dismiss".
- **Dismiss** hides the suggestion for that song. Sections › "From cues" in the header brings it back.

## 7. Sections from cues come out straight
In `sections-not-straight.png`, Intro sits on one line and Verse 1 drops to a second line that covers the Click track. Intro ends after Verse 1 begins, so the row stacks them as overlapping blocks.
- **Sections never overlap:** each section runs exactly from its start bar to the next section's start. Making sections from cues, editing, moving or resizing a section all trim or snap to keep that true.
- **Section starts snap to the bar line** of the cue's bar (a cue a beat or two early, as in a pickup, starts the section on that bar's downbeat).
- **The Sections row is always a single line.** It never stacks, and never draws over the tracks below.
- **Repair on open:** any song whose sections overlap gets repaired once, with an undo note ("Straightened 3 sections in GARDEN · Undo").
- **Tests:** overlapping cue-derived sections become one straight row, on GARDEN's Extended intro version and a fixture.

## 8. A click editor that's readable zoomed out
In `garden-sections-click.png`:
- the notes merge into a solid yellow bar
- the ruler numbers pile into "10111213…"
- the velocity strip is a solid block
- the editor shows bars 1–57 while the timeline above shows 1–105

**The fix:**
- **The editor shares the timeline's zoom and scroll** (one position, as in 9e). The header says which bars are visible.
- **Ruler numbers thin out** with zoom (every bar, 2, 4, 8 or 16), never overlapping.
- **Notes** narrow to thin ticks when they would be under about 4 px wide. Accent and click stay distinguishable. When zoomed far out, draw a density strip instead of individual notes.
- **Velocity** zoomed out draws as a line (the average per pixel column), not a block.
- **Meter changes** ("2/4") get their own thin row in the editor, not on top of the bar numbers.

## 9. Count-in cues collapse when zoomed out
The cue lane shows repeated "Four" labels with "One / Two / Three" crushed into thin lines. When a count-in's labels would overlap, show one "1-2-3-4" label for the group, and for section-word cues, one label per cue. Zoomed in, show them as now. Labels never overlap each other or a section.

## 10. No song-name prefix on track names
Imported tracks are named "GARDEN / 60…", so the useful part is cut off. Inside a song, drop a leading "<song name> / " (or "<song name> - ") from track names, on import and as a one-time cleanup of existing songs (with undo). The full name stays in the track's tooltip.

## 11. The rest of `garden-sections-click.png`
- **Waveforms are scaled to fit the lane height,** as a display-only normalisation per clip, so quiet tracks are visible. The sound is unchanged. Add a small "×N" badge when the display is boosted more than 4×.
- **When a header is narrow,** shorten the track name first and keep the output picker readable ("Out 1", never "Outp…").
- **The horizontal scrollbar** gets its own space below the lanes, not over the modeler track's "Preset 5" label.
- **The bottom track:** with the clip editor open, the timeline scrolls so the bottom track is reachable. The line between the timeline and the editor can be dragged to resize them, and its position is remembered.
- **M / S buttons** have clearly different on and off states (filled colour when on, outline when off) and a tooltip ("Mute", "Solo").

## 12. Parked (don't build yet)
An editable cue clip (one row per cue word, like the click editor) is on hold until the user decides. Don't start it, but don't block it either.

## Report
- the manual test list (max 20, mark [MAC])
- what couldn't be edited or deleted before (item 2)
- every overlap the audit found and fixed (item 3)
- how many existing songs had overlapping sections repaired, and how many track names were cleaned (items 7, 10)
- any decisions that differ from this spec
