# set.Line against docs/daw-conventions.md (phase 12 audit)

Every place the app differed from the conventions guide when phase 12 started, what it does now, and why where it
still differs. Tests for the core conventions: `tests/ui-12.js` (Chrome and macOS WebKit in CI).

## Fixed in phase 12
| § | Where | Before | Now |
|---|---|---|---|
| 6 | Ruler click | Snapped to the Snap grid ("Auto (bar)" at most zooms: the bar line, often behind the pointer); the position came from `getBoundingClientRect`, which macOS 12's WebKit reports in other units under Text size's zoom | The nearest beat, from the pointer's own offset in the ruler (⌘: no snap); a ghost line with bar.beat on hover |
| 6 | Ruler drag | Drag across: zoom to those bars | Up / down zooms (anchored), sideways scrolls (Ableton); double-click: Fit |
| 6 | Pinch | ctrl+wheel / WebKit gesture events: weak (scale ~2 → ×2) and a full redraw every frame | Caught natively on macOS (magnify events), ×6.7 for a full pinch at Normal (Settings › General › Pinch zoom speed), a stretched snapshot during the gesture, one sharp redraw ~120 ms after |
| 6 | = / − | Zoomed around the view's centre | Around the playhead |
| 6 | Z, ⇧Z / X | Not there | Zoom to the selection (section, clip, items); back |
| 6 | Follow | Always on | View › Follow playhead (⌘F); scrolling sideways by hand while playing turns it off |
| 1, 2 | ⌫ after clicking a track header | Deleted (asked about) the whole song: a header click opened the track's panel but didn't make it the selection | ⌫ acts only on what was clicked last: a track, a section, a marker, a tempo or time signature, a break, a clip / cue / MIDI clip, a song; nothing selected: nothing |
| 1, 7 | Several tracks | One at a time | ⇧-click (a range) / ⌘-click (toggle) headers; ⌫ deletes them in one undo step |
| 1 | Esc | Cleared some selections | Clears the selection everywhere (nothing left for ⌫) |
| 1 | ↑ / ↓ in lists | Nothing | Move the selection in the setlist, library, cards and Folders rows |
| 2 | Deleting a track with recorded audio | Asked first | No question (undo restores it) |
| 3 | Undo | Restored the data only | Also the song shown, the selection (track, section) and the scroll position |
| 4 | ↩ | Renamed songs only | Renames the selected track, section or marker too (else: go to start, as before) |
| 4 | ⇥ while renaming | Saved | Saves and renames the next one (tracks, sections, setlist songs, the import's track names); ⇧⇥ the previous |
| 5, 8 | ⌥ while dragging in lanes | Placed freely (no snap) | ⌘ (Ctrl) places freely; ⌥ copies (a clip: the copy stays where it was) |
| 7 | Track meters | Only on hover in some looks, none on MIDI tracks | Always, on every track: level, peak hold, a clip light until clicked; MIDI: an activity light; one canvas at ~30 fps |
| 7 | ⌘-click S | Toggled | Exclusive solo (Ableton) |
| 8 | Click in a lane | Moved the playhead (also while playing) | Sets the insert marker (blinking): ⌘V pastes there, ⌘E splits there; stopped: the playhead goes there too (Space plays from it); playing: no jump (Settings › General › "Click in a lane moves the playhead" › Always) |
| 8 | ⌘E | Export this song | Split the selected clip at the insert marker or the playhead (Export this song: ⌥⌘E) |
| 8 | Click lane | One click opened the editor | A click selects the clip; a double-click opens the editor, again closes it |
| 9 | Click editor | Draw / Select modes (D / S), click to add in Draw only, fixed grids, absolute velocity, no resize, no nudge | Double-click adds / deletes; Draw mode B (⌥-drag erases; Esc leaves); drag moves (⌘ free), up / down changes row, ⌥ copies, straight up / down with ⌥ changes velocity, the right edge resizes; a box; ← → nudge (⇧ a bar), ↑ ↓ row; ⌘C / ⌘X / ⌘V at the insert marker, ⌘D; the velocity strip changes the selection together (relative); Adaptive grid (default) with ⌘1 / ⌘2, ⌘3 triplets, ⌘4 snap; undo |
| 9 | Click editor and Undo | For half a second after an Undo it edited the old copy of the song | Follows the song at once, the selection kept by position |
| 10 | Markers | A click located; no moving them | A click selects (and locates), a drag moves it (snapped to the beat, ⌘ free) |
| 10 | Time signatures | A click opened the editor | A click selects, a double-click edits |
| 11 | Lists | No type-ahead | Typing letters jumps to the first match (setlist, library, cards, Folders rows) |
| 13 | Playback state | The transport buttons' state | PLAYING / STOPPED in Show's top bar |
| 4 | Rename | (11b) | The name element itself is the field, everywhere |

## Still different, and why
| § | Where | What it does | Why |
|---|---|---|---|
| 8 | ← / → with a clip selected | Nudge the clip by a grid step | That's what Ableton does with a clip selected (the guide's "move between clips" is for lists of notes / clips without a nudge) |
| 5 | ⌥-drag a group of items in a lane | Moves them | A group copy is ⌘D (duplicate after the selection); ⌥-drag copies single clips and notes. New feature if wanted |
| 9 | Modeler lanes (Quad Cortex, Axe-Fx) | Their own block editor (drag, ⌫, right-click) | The click editor's gestures don't fit preset / scene blocks; their blocks already select, drag and delete |
| 9 | "Fold" (only the rows in use) | The click editor always shows its two rows | It only has two rows (Accent, Click) |
| 10 | Tempo points | A click selects and shows the value; drag up / down changes the tempo, sideways moves it; double-click types | Matches the guide, except the value shows on the first click (it's the same small popover the drag uses) |
| 11 | ⌥-drag in the setlist | Moves | A song can be in a setlist once (a second copy asks); breaks copy with ⌘D |
| 6 | Click in the ruler while playing | Jumps there at once | The guide's quantized jump is Perform's (unchanged) |

## New features (not built; for the user to decide)
- Recording / arming (deliberately out: the guide's "Deliberate differences").
- Multi-track editing in the click editor (one click track at a time now).
- A group ⌥-drag copy in lanes.
- Clip launching / session view (deliberately out).
