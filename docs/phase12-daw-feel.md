# Phase 12 · Feel like a real DAW: conventions, audit, and fixes from testing 0.1.64

The user: "I'm noticing that you have a tendency to not make features as they would be in a normal DAW from the start."
From now on, **`docs/daw-conventions.md` is the default for every interaction.** Read it first. Everything below follows it.

Show machine: the band's 2015 MacBook Pro, macOS 12, WebKit, 1280×800. Everything must work there; test it in the WebKit CI job.

## 1. Pinch zoom: way too weak and laggy, worst when zooming in
The user's words: "laggy, too weak, like waayyyy too weak", "zooming in is the worst offender, but zoom in and out both need a lot of work". The standard trackpad pinch.
- **Strength:** capture the pinch **natively** on macOS (an `NSEvent` magnify monitor on the window, in JUCE or Objective-C++) and send the real magnification to the page. Zoom by `exp(magnification)`, anchored under the pointer. A comfortable full pinch is about 4–8×. Add Settings › General › "Pinch zoom speed" (Slower / Normal / Faster). On Windows, keep ctrl+wheel with the same feel.
- **Smoothness:**
  - **While a pinch or ⌥-wheel gesture runs,** stretch a snapshot of the visible lanes (CSS transform on a cached bitmap or layer). **When the gesture ends** (about 120 ms without input), redraw sharp.
  - **The redraw after a gesture** must finish in about 150 ms or less on the 2015 Mac.
- **Zooming in:**
  - **Prepare waveform detail levels ahead of time:** in the background after import, and once for existing songs, with progress shown, so nothing is computed during a gesture.
  - **When zoomed past the finest level,** read only the visible range from the file, off the main thread.
  - **Draw only what's on screen.**
- **Measure on the Mac build** (Diagnostics › Show timing, plus a scripted pinch replay in the WebKit CI): frame times during the gesture and redraw time after it, **zooming in and zooming out separately**. Report the numbers.

## 2. Clicking the ruler lands about a bar behind
- **The playhead goes exactly under the pointer** (one shared coordinate system, as in 9e), snapped to the **nearest** grid line (the beat by default); ⌘-click doesn't snap.
- **On hover,** show a ghost line and a bar.beat label.
- **Find and report the cause** (offset or rounding down).
- **Test:** clicks at known x positions, scrolled and zoomed, land on the expected beat, in WebKit.

## 3. ⌫ deletes only the selected item
The user tried to delete an audio track and was asked whether to delete the whole song. Follow conventions §1–2:
- **Clicking a track header (or a clip, section, cue, marker, point) selects that item,** with a clear highlight. The selection moves to it, away from the song.
- **⌫ acts only on the visible selection;** with nothing selected it does nothing.
- **No question for things undo can restore;** the undo note names exactly what went.
- **Test:** select a track, press ⌫: only that track goes, then undo. The same for a section, a cue, a note and a marker.

## 4. Meters on every track
Today only some tracks show a meter (the screenshot showed one on Drum click only).
- **Every audio, click, drum click and cue track** gets a slim meter at the right of its header: level, peak hold, and a clip light that stays until clicked. **MIDI tracks** get an activity light.
- **The outputs pill** gets a small meter for the main outputs.
- **Space for the meter is reserved** and never squeezes the name.
- **Drawn efficiently:** one canvas, about 30 fps, from the levels the engine already computes on the audio thread (lock-free), with no layout work.

## 5. Rename tracks during the Ableton import
- **A new "Tracks" step** in the import window (Sort markers → Options → **Tracks** → Import). Every song's tracks are listed with editable names (in-place rename, conventions §4).
- **Tools:**
  - remove the song name from track names (on by default)
  - name tracks after their audio file (moved here)
  - find and replace
  - "apply this rename to the same track name in every song"
- **A preview** shows the final names.
- **Renames are remembered** per project file for re-imports.

## 6. The new top bar (Show): no buttons
Mockup: `docs/design/phase12/tr4.png`, **concept 4, option A** (top row, "Section progress"). Reference: `tr3.png`.
- **No transport buttons** in Show's top bar. Space plays and stops, clicking the ruler or a section jumps there, and Perform keeps its big buttons. The click toggle moves to the click track's header (it may also stay in the Track menu).
- **Layout, left to right:**
  1. logo and Show / Perform / Band
  2. **a panel tinted with the current section's colour** (a gradient from a coloured left edge), reading "NOW · VERSE 2" plus the song name (large, truncating cleanly)
  3. **section progress:** the current section's name on the left, "next: Breakdown" (in its colour) on the right, a filling bar, and one tick per bar of the section underneath
  4. bar.beat position, then "124 BPM · 4/4 · 1:56 left" in small caps
  5. a status of **PLAYING** (green dot) or **STOPPED** (grey square, showing "Space to play" in place of the next section)
  6. the outputs pill and settings
- **Stopped:** position 1.1 or wherever the playhead is; progress shows the section at the playhead.
- **Breaks (9d):** the panel shows the break's label and countdown instead.
- **At 1280 nothing truncates except the song name.** As space runs short, the small caption drops first, then "next: …".
- **Perform keeps its own transport** and is unchanged, apart from following the conventions guide.

## 7. The click editor works like a real DAW's MIDI editor
Follow conventions §8–9 exactly:
- double-click the lane to open
- double-click to add and delete notes
- Draw mode (B), dragging to move or copy, edge resize
- box select
- arrow-key nudges, ⌘D, copy/paste at the insert marker
- the velocity strip (with ⌥-drag)
- an adaptive grid with ⌘1/2/3/4
- undo

Use the same editor for MIDI modeler lanes where it applies (their blocks already drag; make them follow §8).

## 8. The DAW conventions audit
Go through the **whole app** against `docs/daw-conventions.md`: Show (Cards, Folders, song view, setlist sidebar, clip editors, rows, sections, tempo/meter), Perform, Band, Settings, the import window, and menus/shortcuts.
- **List every place that differs** from the guide: what it does now, what the guide says, and whether you fixed it.
- **Fix them in this phase,** except anything that's really a new feature: list those separately for the user.
- **Add tests for the core conventions:** selection ownership, ⌫ scope, in-place rename, ⌥-drag copy, ruler click position, ⇥ to the next name, type-ahead in lists, the grid keys in editors.
- **Don't change** anything listed under "Deliberate differences" in the guide.

## Report
- the manual test list (max 25, mark [MAC])
- the causes of the ruler offset, the ⌫ scope bug and the weak pinch, in plain words
- the zoom numbers on the Mac build (in and out separately, during the gesture and the redraw after)
- **the full audit:** every difference found, and fixed / not fixed (with a reason)
- any decisions that differ from this spec or the guide
