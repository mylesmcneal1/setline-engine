# Phase 9b · Show layout: setlist sidebar + Cards / Folders

Mockups in `docs/design/phase9/`:
- `f1-wall.png`: the chosen design, Cards view
- `f2-song.png`: a song open from Cards
- `f3-folders.png`: the Folders view
- `d1-select.png`: select mode, delete track, collapse all
- `d2-zoom.png`: zoom
- `l1`–`l5.png`: the five options the user looked at. The chosen design combines **l1's setlist sidebar** with **l2's card wall**, plus a Folders toggle.

Everything must fit at 1280×800 on the 2015 MacBook and stay fast there.

## 1. The new Show screen
- **Left: the setlist sidebar** (from l1). It shows:
  - the setlist name ▾ (switch setlist)
  - numbered songs with colour bars and lengths
  - Break items, hatched (9d)
  - the current/playing song highlighted, with its number in green
  - **+ Song** / **+ Break** buttons and the total "11 songs · 2 breaks · 52:40" in the footer
  - a select icon at the top

  Drag to reorder. Collapsible with the existing « button.
- **Centre: a Cards / Folders toggle** at the top left (segmented control). set.Line remembers the last choice per library.
- **Removed:** the bottom-left "Library" list (its job moves to the centre), the old setlist drop area ("Drag songs here…"), and the old Shows-style stacking in the centre when Cards is active.

## 2. Cards view
- **Tabs:** Songs · Setlists · Presets. Presets is the 8c preset library: if it already has a home, link to it here; don't duplicate it.
- **Filter chips:** All · Not in this set. Search covers name, BPM, key/tuning and preset.
- **A grid of song cards:** 4 columns at 1280, 5 at 1440+. Each card shows:
  - a colour bar at the top and the name
  - a section overview bar
  - a line with tuning · track count · first preset (from the 8c fields)
  - a line with BPM (rounded, 9a), meter and length
  - an **IN SET** badge if the song is in the current setlist
- **Drag a card onto the setlist sidebar** to insert it: an orange line shows where it lands. Dropping a song that's already in the set asks "Add it again?".
- **Opening a song:** double-click a card, or click a song in the setlist. The centre then swaps to **that one song's timeline** (`f2-song.png`), with a **← Library** button and Esc to go back. Clicking another setlist song switches straight to it.

## 3. Folders view (updated version of the old stacked folders)
- **One slim row per song** (about 48 px), in setlist order first and then the rest of the library under a "Not in this set" divider. Each row shows:
  - the colour edge, a chevron and the name
  - BPM · meter · length
  - tuning · preset
  - a section overview bar
  - a ⋯ menu
- **Expanding a row** shows that song's tracks inline (the existing editor).
- **"Only one song open at a time"** is a switch at the top, on by default. Opening a song closes the others.
- **"Collapse all"** is a button at the top, shortcut ⌥⌘←. It's also in View menu.
- **Speed (this was a complaint): opening or closing a folder must feel instant.** Targets on the 2015 MacBook: under 100 ms to open a song with 10 tracks, and under 50 ms to close one.
  - Don't re-render the whole list. Render only the opened song's tracks; virtualise rows that are off screen.
  - Cache waveform peaks. Animate height with a transform, not layout.
  - Measure it, and report before/after times on the PC and (via the Diagnostics timing log) on the Mac.

## 4. Select mode (both views + setlist)
- **The select icon** (setlist header and the centre toolbar) turns on checkboxes. Shift-click selects a range; ⌘/Ctrl-click toggles one.
- **A floating action bar** appears at the bottom: **N selected · Add to setlist · Colour · Duplicate · Export… · Delete · Done**.
  - Delete from the *library* asks for confirmation and lists the songs. Delete from the *setlist* only removes them from the setlist.
  - Everything can be undone.

## 5. Delete a track
- **Right-click a track header:** Rename · Colour › · Duplicate track (⌘D) · Move to another song… · **Delete track** (⌫, red). A trash icon also appears on hover in the header.
- **Undo works.** Ask for confirmation only if the track has audio recorded in set.Line (imported audio stays in the library's media folder until it's cleaned up, so undo can restore it).

## 6. Smooth zoom (this was a complaint: "very laggy, hard to pinpoint")
- **Zoom centres on the mouse pointer:** ⌥ + scroll wheel, or a trackpad pinch. It's smooth, continuous and never jumps.
- **Toolbar:** zoom presets **Song · 32 bars · 8 bars · Section**, a − / slider / + control, and **Fit** (whole song).
- **Drag across the ruler** to zoom to exactly those bars.
- **An overview strip** above the tracks shows the whole song's sections with a white frame. Drag the frame to scroll; drag its edges to zoom.
- **Performance:**
  - Draw waveforms from pre-computed peak levels (e.g. 3 resolutions, generated on import and cached), on a canvas.
  - Throttle zoom to animation frames, and re-render only what's visible.
  - Target 60 fps zooming a 10-track song on the 2015 MacBook. Report the measured frame times.

## 7. Small extras (from 8c's open items)
- The song's own Fields card shows values inherited from the preset (greyed, with "from preset 17A"). Typing replaces it with the song's own value.
- A preset change **in the middle of a song** updates the inherited fields from that point. The band screens' "Until next change" follows it.
