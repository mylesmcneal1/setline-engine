# set.Line · DAW conventions (the default for every interaction)

**Rule:** anything you can select, edit, move or play behaves the way it does in **Ableton Live** (first) and **Logic Pro** (where Ableton has no equivalent). A musician who knows either should never have to learn a set.Line way of doing a standard thing.

**Deviations** are allowed only when they're written down in the "Deliberate differences" section at the end, with the reason. If a spec doesn't mention a behaviour, follow this guide. If it conflicts with this guide without saying so, follow this guide and note it in the report.

---

## 1. Selection and focus
- **A single click selects exactly the thing clicked:** a track (its header), a clip, a note, a section, a cue, a marker, a tempo or time-signature point, a song row or card, a break. The selection clearly highlights.
- **The selection belongs to the last thing clicked,** never to a parent "behind" it. Clicking a track header selects the track, not its song.
- **Clicking empty space clears the selection.** Esc clears it too.
- **⇧-click** extends a range in lists, and adds or removes items in timelines and editors. **⌘-click** toggles one item.
- **Drag across empty space** (in a lane, the clip editor or a list) makes a box (marquee) selection.
- **Keyboard focus** follows the last clicked area (setlist, timeline, editor, track headers). Shortcuts act on the focused area.
- **The arrow keys** move the selection within a list (↑ ↓) or between notes and clips (← →) when that area has focus.

## 2. Delete, cut, copy, paste, duplicate
- **⌫ or Delete removes only the selected item(s).** With nothing selected, it does nothing. It never deletes a parent (song, setlist) because a child was "active".
- **While a text field has focus,** ⌫, ⌘A, ⌘C, ⌘V, ⌘X and ⌘Z act on the text only.
- **⌘X / ⌘C / ⌘V:** paste goes at the playhead, or at the insert marker (the last clicked position) in a lane or editor, or after the selected item in lists.
- **⌘D duplicates the selection immediately after itself:** clips and notes go right after the selection's end, tracks below themselves, songs and breaks after themselves.
- **No confirmation dialogs for deletes that undo can restore.** Ask only when it can't be undone (deleting a library) or when the item is used elsewhere (a preset used by songs, a version in a setlist).
- **Every destructive action shows the undo note** naming exactly what happened.

## 3. Undo
- **Everything that changes the show is undoable:** edits, moves, deletes, renames, imports, repairs, track settings (output, volume, mute/solo state edits), sections, tempo, meter, MIDI and setlist order.
- **⌘Z / ⇧⌘Z.** Undo history survives switching songs, but not relaunching (as in Ableton).
- **Undo restores the selection and scroll position** as they were before the change.

## 4. Rename
- **Double-click a name, or select it and press ↩,** and the name *itself* becomes editable in place: same element, font and position, with all its text selected.
- **↩ or clicking away saves. Esc cancels. ⇥ saves and moves on to the next item's name** (as in Ableton's track names).
- **The row never moves or resizes** while you edit.

## 5. Drag and drop
- **Dragging is done with pointer events,** with a 4 px threshold before it starts.
- **While dragging:** a ghost of the item follows the pointer, a line shows exactly where it will land, and the list or timeline auto-scrolls near the edges.
- **⌥-drag copies; plain drag moves.** In timelines, ⌘ during a drag turns off snapping.
- **Esc during a drag cancels it.** Dropping outside a valid target cancels too.
- **Items that can be dragged** show a grab cursor and a grip on hover.
- **Files dragged from Finder or Explorer** import where they're dropped (a library, the setlist, a song's lanes).

## 6. Timeline: ruler, playhead, scroll, zoom
- **Click the ruler** and the playhead moves exactly under the pointer, snapped to the **nearest** grid line (beat by default, never "back to the start of the bar"). ⌘-click doesn't snap. A ghost line plus a bar.beat label shows on hover.
- **Click in the ruler while playing** and playback jumps there (quantized jumps are a Perform-only feature unless the user turns them on).
- **Drag in the ruler** zooms (Ableton: drag up/down to zoom, sideways to scroll). Double-click the ruler for Fit.
- **Scroll wheel / two-finger swipe:** vertical scrolls the tracks, horizontal scrolls time. ⇧ + wheel scrolls time.
- **Zoom:**
  - **Trackpad pinch** (captured natively on macOS) and **⌥ / ⌘ + wheel** zoom, anchored under the pointer.
  - **The zoom amount is proportional to the gesture:** a full pinch is about 4–8×.
  - **= / −** zoom around the playhead (Ableton: +/−); **Z** zooms to the selection; **⇧Z or X** goes back.
  - **Smoothness:** zoom must feel immediate on the 2015 MacBook. Stretch a snapshot while the gesture runs, redraw sharp when it ends, and keep waveform detail levels prepared ahead of time.
- **Follow playhead** (Ableton's ⌘F "Follow") is a toggle. It pages the view, and turns itself off when the user scrolls by hand.
- **The pinned rows (ruler, time signature, tempo, sections) and the track headers never move with scrolling,** as specified in 9e.

## 7. Tracks and track headers
- **Clicking a header selects the track.** ⇧ / ⌘-click select several.
- **Double-click the name to rename it.** Double-clicking empty space in the header does nothing.
- **Track order:** drag the header (grip) to reorder. ⌥↑ / ⌥↓ moves the selection.
- **Mute / Solo:** M and S toggle. ⌘-click S makes it exclusive solo (as in Ableton).
- **Every track has a level meter** (MIDI tracks: an activity light).
- **Height:** drag the bottom edge, ⌥-drag for all. The header's controls collapse in a fixed order and the name is always readable.
- **Arm / record isn't used.** No fake buttons.
- **A track's right-click / ⋯ menu:** Rename, Colour, Duplicate, Delete, Move up/down, Height.

## 8. Clips and lanes
- **Audio and MIDI clips** can be selected, moved (snapped), ⌥-dragged to copy, trimmed at the edges, split (⌘E at the playhead or insert marker) and deleted.
- **Double-click a MIDI clip or lane** to open its editor under the timeline (Ableton's detail view). Double-click again, or press Esc, to close it.
- **The insert marker:** clicking in a lane sets a blinking insert line (the paste position) and doesn't move the playhead unless "Click in lane moves playhead" is on.

## 9. MIDI editing (click clip, modeler lanes, any MIDI)
- **Double-click empty grid to add a note; double-click a note to delete it.**
- **Draw mode (B):** click to add, drag to paint, ⌥-drag to erase. **Esc or B** leaves Draw mode.
- **Notes:**
  - drag to move (snapped; ⌘ for free)
  - drag up or down to change pitch / row
  - ⌥-drag to copy
  - drag the edges to resize
- **Select:** a box (marquee) on empty grid, ⇧-click to add, ⌘A for all.
- **Keyboard:** ←/→ nudge by one grid step (⇧ for a bar), ↑/↓ change pitch / row, ⌘D duplicate after the selection, ⌘C / ⌘V paste at the insert marker.
- **Velocity:** a strip under the notes; drag bars; selected notes change together (relative). ⌥-drag a note up or down changes its velocity (as in Ableton).
- **Grid:** Adaptive (it follows the zoom, the default), plus fixed 1/4, 1/8, 1/16 and triplets. ⌘1 narrows the grid, ⌘2 widens it, ⌘3 toggles triplets, ⌘4 turns snapping on or off (Ableton's keys).
- **Loop or fold:** the click and cue editors show only the rows in use (like Ableton's Fold).

## 10. Sections, markers, tempo and meter
- **These all behave like clips:** click to select, drag to move (snapped to bars), drag edges to resize (sections), double-click a name to rename, ⌫ deletes the selection, right-click for a menu.
- **Sections never overlap.** Each one runs to the next section's start.
- **Tempo and time-signature points:** click to select, drag to move, double-click to edit the value, ⌫ deletes (bar 1 can't be deleted). Right-click or double-click the row to add one.

## 11. Lists (setlist, library, Folders, cards)
- **Single click selects; double-click opens** a song (or renames when you double-click the name text itself).
- **↩ renames the selected item. ⌫ deletes it** (from a setlist, removes it from the setlist; from the library, deletes it with undo).
- **Drag to reorder. ⌥-drag copies.** Drag from the library into the setlist inserts.
- **Typing letters jumps to the first matching name** (type-ahead, as in Finder).

## 12. Menus, shortcuts and right-click
- **Every action has a menu-bar item.** Context actions are also in the right-click menu and ⋯. All of them show their shortcut.
- **Use the platform conventions:** ⌘ on Mac and Ctrl on Windows. Settings is ⌘, on Mac. Mac-standard keys (⌘W, ⌘Q, ⌘M, ⌘H) are never repurposed.
- **Keys must not fight the system,** and single-letter keys don't fire while typing.

## 13. Feedback
- **Hover shows a cursor that matches the action** (grab, resize, pencil, text) and a tooltip after about 500 ms with its name and key.
- **Anything slower than about 300 ms** shows progress. Nothing freezes the interface.
- **Playback state is always visible,** with a playing / stopped indicator.

---

## Deliberate differences from Ableton (with reasons)
- **No session view, clip launching, devices or effects.** set.Line is for playing arrangements live.
- **No recording or arming.** set.Line plays back; it doesn't record audio.
- **There are no transport buttons in Show's top bar** (Phase 12). Space plays and stops there, and Perform has the big buttons, because Show is for building and Perform for the gig.
- **Satellites (band screens) never control levels.** They're for following the show, not mixing it.
- **The click is a two-lane MIDI clip** (Accent / Click), not Ableton's metronome setting, so it can be edited per song.

- **A click in a lane while a song plays sets only the insert marker** (no jump), as the guide says; while stopped the playhead goes there too, so Space plays from it (Ableton plays from the insert marker). Settings › General can make every lane click jump.
- **⌥-drag on a note is a copy when it goes sideways, a velocity change when it goes straight up or down.** Ableton uses two modifiers for these; the guide gives both to ⌥, so the direction decides.
- **↩ renames the selected item** (as the guide says) **and is still "go to start" when nothing nameable is selected**, because the band uses ↩ that way on stage.
- **⌘E is Split** (Ableton); Export this song moved to ⌥⌘E.

- **An audio clip's level line takes the pointer only on the selected clip** (Phase 13): elsewhere a plain drag always moves the clip, so a quick move never turns into a gain change.
- **Snapping uses the Snap grid everywhere** (Phase 13): the bar by default and the Adaptive grid only once its lines are 40 px apart, so a click near a bar lands on that bar (30 % in: its start; 70 %: the next).
- **⌫ on a version that a setlist plays still asks** (the conventions allow it: it's used elsewhere); setlist rows and library songs go without a question.
- **File › Save Library (⌘S) is a commit point; autosave keeps writing every change** as the safety net. Quitting with changes since the last save asks Save / Don't Save / Cancel, and Don't Save puts the last saved library back.
- **Key Commands remaps the menu commands** (those with ⌘ / Ctrl). Single keys that act on what's selected (Space, ⌫, ↩, B, Z, arrows) are listed but fixed.
- **A song's count-in is spoken counts in the bars before its first section** (set.Line has no pre-roll before bar 1): a song whose first section starts at bar 1 keeps the setting without counts until it gets a bar before it.

- **A break is edited in one popup** (Phase 14) with Save / Cancel, not in place: it has four fields. Clicking away
  cancels, like Esc, so a stray click never changes a break.
- **Add section on a bar inside a section splits it** (Phase 14), as adding a locator splits an arrangement section;
  on a section's first bar it splits that section in half, since sections never overlap.

(Add to this list, with a reason, whenever set.Line deliberately departs from a convention.)
