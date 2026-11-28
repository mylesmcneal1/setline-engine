# Phase 16 — Remote editor: placement, previews, widget refresh

Mockups (approved: "That's fantastic"): `docs/design/phase16/rw.png` (editor), `docs/design/phase16/rw2.png` (widget styles).
Builds on Phase 15 (WYSIWYG editor, grid, device presets, per-widget style, phone stacking). `docs/daw-conventions.md` still applies (Figma/Keynote-style canvas conventions where the DAW has none). Show Mac (macOS 12.7 WebKit, 1280×800) must work. Remotes never get level, gain or mute controls.

The user's complaint: "really hard to get them center screen", widgets "could look better", wants "a preview before dragging them in".

## 1. Widget library with live previews — rw.png (left)
- Left panel: search, category tabs (All, Song, Time, Controls, Setlist), 2-column grid of tiles. Each tile is a **live miniature of the real widget** (same renderer as the device, live data if a song is loaded, sample data otherwise) with its name.
- Hover (or select a tile with the keyboard) → a larger preview popover over the library (not over the canvas) with the widget's style variants; pick a variant, then drag. Double-click a tile adds it at the first free spot.
- While dragging in: a ghost outline at the drop position with snapping already applied; drop places it there.

## 2. Placement and centring — rw.png (toolbar + canvas)
- Toolbar: **Align to: Screen | Selection** toggle (default Screen with one widget selected, Selection with several). Align left / **Centre** / right, top / **Middle** / bottom, distribute horizontally / vertically, make same size. Tooltips with shortcuts.
- One click on Centre puts the selection exactly in the horizontal centre of the screen (Middle = vertical). With several widgets and "Screen", the group is centred as a block, keeping relative positions.
- Smart guides while dragging/resizing: pink lines + snap to screen centre (both axes), screen edges/safe areas, other widgets' edges and centres, and equal spacing; a "Centred" badge when on the centre line. ⌘/Ctrl-drag ignores snapping. Works with the grid on or off (grid off = free placement, guides still snap).
- Exact placement: x / y / w / h fields (grid units when the grid is on, otherwise points), lock position, arrow keys nudge (⇧ = bigger step).
- Add Centre, Middle and the align commands to Key Commands with free, conflict-checked shortcuts; document them in docs/menus.md.

## 3. Fuller inspector — rw.png (right)
- Layout: x/y/w/h, padding slider + value, corner radius slider + value, lock.
- Style: the widget's variants as visual chips (see 4).
- Text: size Auto-fit / Fixed (slider when fixed), weight Regular/Bold/Heavy, label Hidden/Top/Bottom, font (the app's font pairings).
- Colours: background Solid/None/colour, text and accent colour (colour wheel), "Use section colour" toggle, border, shadow, opacity.
- All controls work on a multi-selection (mixed values shown as "—"). Everything undoable.

## 4. Widget refresh — rw2.png
- Every widget gets 2–3 built-in styles:
  - Song title: Big (centred, NOW · 1 OF 4, section · bar x of y) / Compact (name, section, next, progress bar) / Section-coloured (gradient + left stripe in the current section colour, "next: Verse 1 in 6 bars").
  - Tempo: Big / Compact (number + BPM, meter) / Beat lights (dots per beat, current beat lit, plus BPM · meter).
  - Time (clock, time left, bar.beat): Big with progress bar / Compact pair (clock | left) / Ring (circular progress + bar.beat).
  - Controls: Big Play (with "from Intro · song" line) / Compact Play + Sync MIDI pair / Hold-to-stop (stop requires a hold; tap does nothing — safety on stage).
  - Cue word: Big word / Compact with "in 2 bars · 4 3 2 1" countdown / Flash (whole box flashes in the cue's colour on the cue).
  - Setlist, Next song, Sections, Song notes: same treatment (Big / Compact / one sensible alternate), consistent with the above.
- Shared look: soft gradient boxes, consistent small caps labels, bigger/bolder numbers (Outfit for numbers by default, follows the font setting), text always auto-fits its box on any device (no truncation, no overflow).
- Existing screens keep working: old widgets map to the Big style with their current colours.

## Testing
- WebKit tests: drag from library with ghost + snap, Centre/Middle to screen and selection, group centring, smart guide snapping to centre, ⌘-drag bypass, inspector multi-select edits, undo/redo, every widget × every style renders at iPad, iPhone (390×844) and iPhone SE (375×667) with no overflow.
- Visual snapshots of the library tiles and each style.
- Keep Windows and macOS-15 CI green.
- Report: what changed, anything not done and why, new version.
