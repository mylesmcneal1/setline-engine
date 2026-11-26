# Phase 10a · Fixes from testing 0.1.60 on the Mac, plus drag and reorder everywhere

Tested by the user on the band's 2015 MacBook (macOS 12, 1280×800). Every item must work **in macOS 12's WebKit**, not just in Chrome or on Windows. Test there (the CI WebKit run plus the manual list).

## 1. Pinch zoom on the Mac trackpad is far too weak
- **The problem:** a trackpad pinch reaches the page as many tiny `wheel` events with `ctrlKey`, and WebKit also fires `gesturestart` / `gesturechange` with a `scale` value. The current zoom barely moves.
- **The fix:**
  - Use WebKit's gesture events when they exist: apply `scale` directly, relative to the scale at `gesturestart`.
  - Otherwise use exponential scaling of `ctrl+wheel`: `zoom *= exp(-deltaY * k)`, with `k` tuned so one full pinch is about 4×.
  - Always anchor at the pointer.
- **⌥ + wheel** keeps working and uses the same exponential curve.

## 2. Smooth zoom motion
The user: "option works good for zoom, I just want a bit more quality on the zoom … the motion."
- **Zoom glides** to its target with a short ease (about 120–160 ms, critically damped) instead of jumping per event. This applies to ⌥-wheel, pinch, the slider, +/−, the presets (Song / 32 bars / 8 bars / Section), Fit and Fit all.
- **Continuous input** (pinch, wheel) retargets smoothly mid-animation, with no stutter.
- **Keep the 9e structure:** one shared position and zoom, lanes moved in the same frame, and only the lanes re-rendered.
- **Respect Customize › Reduce animations:** when it's on, zoom jumps instantly.
- **Report frame times** while zooming on the PC; the Mac numbers come from Diagnostics › Show timing.

## 3. Renaming songs doesn't work (Folders and Cards)
- **Make all of these work:**
  - double-click the name on a card, a Folders row or a setlist row
  - double-click the big title in the opened song
  - ↩ on a selected song
  - right-click › Rename…
  - Song › Rename song…
- **Inline editing:** Esc cancels, ↩ / clicking away saves, and undo works.
- **Find out why it fails today** and add a UI test that renames from each place (WebKit included).

## 4. Drag and drop doesn't work on the Mac
"Drag and drop for song cards to create a set doesn't work."
- **The likely cause:** HTML5 drag and drop inside the app's WKWebView on macOS 12.
- **The fix:** replace it with **pointer-event dragging**: pointerdown / move / up, a 4 px threshold, a drag ghost and an auto-scroll near the edges. One shared helper serves every drag in the app.
- **Keep native file drops** (.als / audio from Finder) as they are; they come in through the app, not HTML5 dragging.
- **Drags to cover:**
  - a card or Folders row onto the setlist sidebar (insert, with the orange landing line)
  - reordering inside the setlist (item 5)
  - reordering tracks (item 6)
  - scene / preset blocks (8c), clips, sections and cues, wherever they're draggable today: move them onto the helper if they use HTML5 dragging
- **Test it in WebKit:** a UI test performs each drag with pointer events.

## 5. Reorder the setlist, songs and breaks
- **Drag any setlist item (song or Break)** to a new position. While dragging, a grip shows on hover (10b) plus the orange landing line.
- **⌥↑ / ⌥↓** moves the selected item.
- **Right-click** › Move up / Move down / Remove from setlist; also in the Setlist menu (10b).
- **Multi-select** (select mode) drags as a group.
- **Undo** works.
- **Band screens, Perform and the backup rig** pick up the new order.

## 6. Reorder tracks within a song (MIDI included)
- **Drag a track header** up or down: audio, click, cues and MIDI, in Folders and in the single-song view. A blue line shows where it lands.
- **⌥↑ / ⌥↓** moves the selected track; right-click › Move up / Move down stays.
- **Undo** works. The order is saved per song and per version.

## 7. MIDI tracks at the bottom by default
- **New MIDI tracks** are added at the bottom of the song.
- **Every importer** (Ableton and the rest) puts MIDI tracks under the audio, click and cue tracks. Keep Live's order otherwise.
- **Song › Sort tracks › MIDI to the bottom,** also available for a selection of songs (select mode). Undo works.
- **The user's own order is never changed** automatically after that.

## 8. "Open a library first" while a library is open
The user saw this when choosing File › Import Ableton project… (0.1.60). Check that `lib` is set for every path that reaches `importAbleton()` (menu bar, ⌘I, drop, first run), including straight after launch and after switching libraries. If no library truly exists, offer **"Create a library"** right in that message instead of a dead-end toast.

## Tests
UI tests in Chrome **and** WebKit for items 1–8. The manual Mac list is in the final report.
