# Phase 9e · Timeline fix: pinned ruler, one scroll, track sizes, time signature row, import reliability

This is an urgent fix after testing 0.1.59 on the band's MacBook (macOS 12, 1280×800). The user's screenshots are in `docs/design/phase9e/`:
- `mac-ruler-tempo.png`: the top of a song (ruler, Tempo, Sections) before scrolling.
- `mac-unravelled.png`: the same song after scrolling down and zooming or moving sideways. In the user's words: "the main ruler moves when I scroll down … when I want to zoom out or move side to side, it's like everything comes unraveled."

## 1. One timeline structure (how every DAW does it)
In `mac-unravelled.png`:
- the ruler has scrolled away
- a second ruler is drawn inside the tracks (the "1 5 9 13…" row under the click lane), offset into the header column
- the sections start at VERSE A while that ruler starts at bar 1, so the layers have **separate horizontal scroll positions**
- the track headers have scrolled sideways, so their names are cut off ("…nes 1-8", "Ch 5")
- there's an empty dark column between the headers and the lanes

Rebuild the song timeline as **one grid**:
- **Pinned at the top**, always visible while scrolling down: the **ruler**, the **time signature row** (section 3), the **tempo row** and the **sections row**. The song header and toolbar sit above them and stay put.
- **Pinned on the left:** the track headers. They scroll **only vertically**, in step with their lanes, and never sideways.
- **One horizontal scroll position and one zoom level** for everything: the ruler, meter, tempo, sections, every lane, the playhead, the loop/selection and the overview frame. Implement it as a single scroll container, or a single shared offset applied in one place, so no layer can drift. Every input must update that one value:
  - the scrollbar and trackpad swipes
  - shift + wheel
  - dragging the overview frame
  - ⌥ + wheel / pinch zoom (anchored at the pointer)
  - the zoom presets, Fit, and drag-to-zoom on the ruler
  - follow-playhead
- **Exactly one ruler.** Remove the extra ruler inside the tracks.
- **No dead column:** the lanes start directly after the header column.
- **The overview strip** draws the song's section colours inside it, with the white frame on top (it's blank today).
- **Dense cue labels** (the "Four / Three" pile-ups near section starts): stagger into at most 2 rows, never overlap the clip edges, and show the full text on hover.
- **Empty-lane hints** (e.g. "Drag one from the right panel onto this bar") stay fully visible at any scroll position, or are dropped.
- **Test it:** a UI test scrolls down 3 screens and sideways 50 bars, zooms in and out at the pointer, and asserts that the ruler, the sections and every lane show the same bar under the same x (±1 px), and that the headers' left edge never moves. Run it at 1280×800 and in Folders view with 2 songs open.

## 2. Adjustable track sizes, and see everything at once
The user: "Ultimately I want to be able to see everything at one time if I choose."
- **Per track:** drag a track's bottom edge to resize it. ⌥-drag resizes **all** tracks of that song together. Double-click the edge to return to the default.
- **Sizes:** 5 steps plus free drag:
  - **Mini** (about 16 px: name only, a thin lane)
  - **Small**
  - **Medium** (the default)
  - **Large**
  - **Huge**

  At Mini/Small, the header hides its slider, the output selector and the M/S labels progressively (the name and colour always stay). Waveforms and blocks scale with the height.
- **View › Track height** (and the toolbar): Mini · Small · Medium · Large · Huge, applied to all tracks of the open song. Shortcuts: ⌥⌘− / ⌥⌘= shrink and grow all.
- **Fit tracks to window** (⌥⌘F, plus a button next to Fit): sizes every track so the whole song's tracks fit the visible height. Together with horizontal **Fit**, a new **"Fit all"** shows the entire song (every bar and every track) on one screen. Pressing it again returns to the previous zoom and sizes.
- **The pinned top rows** (ruler / meter / tempo / sections) have compact versions too, so Fit all also works on the 2015 MacBook's 800 px height. Tempo and meter can collapse into a single thin "Tempo · Meter" row.
- **Sizes are saved per song,** with a global default in Customize › Track height (from 9c, now wired to this).

## 3. Time signature row, always visible
The user: "time sig should always be visible like the main ruler and tempo."
- **A permanent "Time signature" row** in the pinned top area, between the ruler and Tempo, styled like the Tempo row: the label on the left, the current value at the right of the header ("4/4"), and the lane showing "4/4" at bar 1 plus a badge at every change ("3/4" at 97).
- **It shows in every song,** even with no changes.
- **The current meter sticks** at the left edge of the lane while scrolling, so you always know the meter at the screen's left edge.
- **Click a badge** to edit it (the 9a popover). Right-click or double-click the row to add a change. It behaves the same as the Tempo row.
- **The cyan badges on the ruler** can stay, or move to this row: pick whichever reads cleaner and note it.

## 4. Import Ableton sometimes does nothing (Mac)
"Import Ableton project…" from the Mac menu bar often does nothing on the first clicks and works after a few tries.
- **Find the cause and fix it.** Suspects:
  - the native FileChooser opening behind the window, or not at all, when launched from a menu-bar callback on macOS 12
  - `packChooser` being reused or replaced while an earlier chooser is still pending (several features share it)
  - the menu command arriving while the page isn't ready
- **The fix:**
  - give each feature its own chooser, or refuse a second launch while one is open
  - launch from the message thread after the menu closes (`callAsync`)
  - make sure the dialog comes to the front (activate the app first)
  - add a log line for each step (menu received → chooser opened → result)
- **Check the other menu items** that open a file or folder dialog (Import .setline, Import audio, Export, Print, MIDI mappings) for the same problem.
- **Manual test for the report:** ten clicks in a row on the Mac open the dialog ten times.

## Report
- what was wrong with the scrolling (the cause), in plain words
- the import cause
- before/after screenshots at 1280×800: scrolled down, scrolled sideways, zoomed out, Fit all, Mini tracks
- the measured zoom frame times again (they shouldn't get worse)
