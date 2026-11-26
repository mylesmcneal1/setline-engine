# Drag, zoom and rename (10a)

Code: `ui/public/fix10a.js` / `fix10a.css` (drags, renaming, ⌥↑ / ⌥↓, MIDI order), the zoom glide in
`ui/public/show9.js`, the library check in `ui/src/pages/arrange.ts` (`needLibrary`). Tests: `tests/ui-10a.js`,
run in Chrome (`tests/ui-timeline.mjs`) and in WebKit (`tests/ui-webkit.mjs`, CI on the Mac runner).

## Zoom
- **Pinch** on a trackpad: Chrome and WebView2 send it as `wheel` events with `ctrlKey`; the zoom is
  `exp(−deltaY · 0.02)` per event, so one full pinch is about 4×. WebKit (the Mac app) sends `gesturestart` /
  `gesturechange` with a `scale`: the zoom is the zoom at the start × `scale`. While a gesture runs, ctrl + wheel
  events are ignored (WebKit can send both).
- **⌥ + wheel**: `exp(−deltaY · 0.0025)`, ×1.28 per mouse-wheel notch.
- Always anchored at the pointer: the time under it stays put for the whole gesture.
- **The glide:** every zoom (wheel, pinch, slider, + / −, the presets, Fit, Fit all and back) moves along a critically
  damped spring on log(zoom), about 150 ms. More input during a glide moves its target; nothing restarts. Presets and
  Fit glide the left edge too. Each frame redraws only the open song(s) and then sets the one sideways position
  (the 9e structure). **Customize › Reduce animations**: the zoom jumps.
- Frame times are in Diagnostics › Show timing ("zoom frame").

## Drag and drop
**Why it didn't work on the Mac:** the app's window takes files dragged in from the Finder itself
(`app-gui/MacDrop.mm` unregisters the web view from every drag type, so the window gets real file paths). That
also cut off the page's own HTML5 drags: a card could be picked up, but no drop ever reached the setlist.

Every drag in the page now uses pointer events through one helper (`SLDrag`): a 4 px threshold, a ghost under the
pointer, a landing line, auto-scroll near the top and bottom of the list under the pointer, Esc to cancel. Files
from the Finder / Explorer still come in through the app as before.
- A card, a Folders row or a library row → the setlist sidebar: an orange line shows where it lands. A selection
  (select mode, ⌘-click) goes in together. A song already in the setlist moves to the line instead.
- Setlist items (songs and breaks) reorder in the sidebar; a selection moves as a group.
- Track headers (audio, click, cues and MIDI) reorder within their song, in Folders and in one song: a blue line.
- The older drags (a version's sections, presets onto the MIDI timeline, Quad Cortex / Axe-Fx presets and scenes
  onto a lane, band screen widgets) are marked `data-drag10`: the helper drives them and calls their existing
  handlers with a stand-in `dataTransfer`.

## Moving with keys and menus
- **⌥↑ / ⌥↓** moves the selected setlist item (song, break, or the selected songs) or, after a click on a track
  header, the selected track.
- Right-click a track › Move up / Move down; right-click a song in the setlist › Move to top / bottom.
- Every move shows a note with Undo ("Moved “Glasshouse” to #3 in Full show").

## Renaming a song
**Why it didn't work:** Rename… re-drew the list and then looked for the old song folder's title (`.folder .fh
.nm`), which the 9b Cards and Folders views don't have, so nothing happened. A double-click on a setlist row
never arrived because the first click re-draws the row.

Now the name is edited where it is: double-click the name on a card, a Folders row, a setlist row or the big
title of the opened song; ↩ on a selected song; right-click › Rename…; Song › Rename song…. ↩ or clicking away
saves, Esc cancels, ⌘Z undoes. A ✎ shows on hover. (↩ on a card used to open the song; double-click it or use
Open in its menu instead.)

## MIDI tracks at the bottom
- A new MIDI track is added at the bottom; a new audio or click track goes above the MIDI tracks at the bottom.
- The Ableton import keeps Live's order but puts MIDI tracks under the audio, click and cue tracks.
- **Song › Sort tracks: MIDI to the bottom** does it for the song, or every selected song. Undo works.
- Nothing reorders the tracks by itself after that.

## "Open a library first"
**Why:** the library opens in the background at start-up (seconds for a big one on the 2015 MacBook). 0.1.60
made the menu bar work, so File › Import Ableton project… could now arrive before that finished, and the import
refused instead of waiting. The same happened after a page reload whose library re-open failed: no library was
open again until a restart.

Now anything that needs the library waits for the start-up open, then reopens the last library (or makes
"My Library") if none is open; only when that fails does it ask, with **Create a library** right in the message.
Each step is in the log.
