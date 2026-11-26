# The song timeline (9e)

Code: `ui/public/time9e.js` and `time9e.css` (loaded after `show9.js`), with the rows built in `renderFolders` in
`ui/1-arrange.html`. Native side: `app-gui/AppMenus.*` and `app-gui/Dialogs.*`. Tests: `tests/ui-timeline.mjs`
(`timeline-check.js`, `timeline-sizes.js`), `tests/ui-layout.mjs` (view `meter`), `set.Line --menu-test`.

## One grid
- **Pinned at the top:** the ruler, **Time signature**, **Tempo** and **Sections** rows (`.pin9`, `position: sticky`).
  They stay put while the tracks scroll down. The song header and the toolbar sit above them.
- **Pinned on the left:** the track headers. They move only up and down with their lanes, never sideways.
- **One sideways position, one zoom.** The scroller only scrolls up and down. Every row clips its own lane, and all
  lanes are moved left by the same amount, `TL9.hx`, in the same frame as their pictures are drawn. That covers the
  ruler, time signature, tempo, sections, every track, the playhead, the loop and the overview frame. Code that
  read or set the scroller's `scrollLeft` (zoom, Fit, the overview frame, follow-playhead, drag-to-zoom) still does;
  `scrollLeft` on `#scroller` now reads and sets that one position.
- **Sideways input:** trackpad swipes, Shift + wheel, the scrollbar under the lanes (`#hb9`), and dragging the
  overview frame. ⌥ + wheel (or a pinch) zooms around the pointer, and one gesture keeps its exact anchor.
- **One ruler.** Its header cell is opaque now, so the bar numbers slide under it (it was see-through before).
- **The overview strip** draws the section colours.
- **Cue labels** stay inside the clip, below its title band, on at most 2 rows (1 in a short lane). A label never
  runs into the next one or past the clip's end: it is shortened, or only its tick shows. Hover shows the full text.
- **Hints** in empty lanes ("No preset yet…", "Empty…", "Drag across this lane…") sit at the visible left edge.

### What was wrong (0.1.59)
- 9b added `.trk .lh{position:relative}` (for the hover trash button). That silently replaced the headers'
  `position: sticky; left: 0`. Scrolling sideways then carried the track headers off the left edge: names were cut
  off, and an empty, header-wide column appeared before the lanes.
- The ruler's header cell had been made see-through (8a, `opacity: 0`), so the ruler's own bar numbers and
  time-signature badges showed through in that empty column. It looked like a second ruler inside the tracks.
- Only the ruler was pinned: Tempo and Sections scrolled away.
- The overview strip's section colours used CSS `color-mix()` with a variable. macOS 12's WebKit doesn't support
  that, and there the colour fell back to transparent: a blank strip. (Every `color-mix()` in the page had the same
  problem. `time9e.js` swaps them for plain colours where `color-mix()` isn't supported; `?nocolormix` forces it.)

## Time signature row
Between the ruler and Tempo, in every song. It shows 4/4 at bar 1 and a badge at every change. The header shows
the meter at the playhead, or at the left edge. While scrolling, the meter in force sticks at the left edge of the
lane. Click a badge to edit it (the 9a popover); double-click or right-click the row to add a change. The cyan
badges moved off the ruler into this row: one place for meters reads cleaner, and the ruler keeps only bar
numbers and markers.

## Track sizes
- Drag a track's bottom edge (in its header) to resize it; ⌥-drag resizes every track of the song; double-click
  the edge goes back to the default (⌥-double-click: every track).
- **View › Track height:** Mini (18 px: the colour and the name only) · Small (32: no fader, output or meter) ·
  Medium (50) · Large (76) · Huge (120). ⌥⌘− / ⌥⌘= step every track. Waveforms and blocks scale with the height.
- **Fit tracks to window** (⌥⌘F, the ↕ button in the ruler's header cell): every track of the song in the
  visible height.
- **Fit all** (the ruler's header cell, or View › Fit all): compact top rows, the whole song across, every track
  down. Press it again to go back to the zoom, position and sizes from before.
- **Compact top rows** (View menu): ruler 18, time signature 16, tempo 26, sections 22 px.
- Sizes are saved with the song (`trkH` for every track, `trkHs` per track). Without them, a track uses
  Customize › Track height (the same five sizes; Medium by default).

## Menu commands and file dialogs (Mac and Windows)
- **The cause:** a menu item handed its command to JUCE's command manager, which looks for a target, starting
  from the focused component. That is the web view, which isn't a command target, and our menus had never been
  set as the first target. So a chosen menu item did nothing.
  `AppMenus` now sets itself as the first target. `set.Line --menu-test` chooses items exactly as the menu bar
  does (including a submenu and the app menu) and checks each arrives once (CI, Windows and Mac).
- **Every native file / folder dialog** (Import Ableton, Locate samples, Import / Export .setline, MIDI mappings,
  audio files, patch sheet PDF, diagnostics, shows folder, sessions) goes through `dialogs::open`:
  - each feature has its own chooser
  - a second request while one is open is refused (answered as "cancelled")
  - the dialog opens on the message thread after the menu has closed, with set.Line brought to the front first
  - each step is logged: "Menu: m:importAbleton" → "File dialog "Import Ableton project": requested" → "opened"
    → the result

## Speed (zoom frame, real 8-track EIA songs, this PC, same app build)
0.1.59: 10.4–10.5 ms median. Now: 10.1–10.2 ms median. A first version moved the lanes with a CSS variable on the
scroller; that restyled everything in it each frame (+4 ms), so each lane now gets its own transform.
