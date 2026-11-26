# The Show screen (9b)

Code: `ui/public/show9.js` and `show9.css` (loaded after the page script; they wrap its `renderFolders` /
`renderSetlist`). Tests: `tests/ui-layout.mjs` (views `show`, `folders`, `song-open`, `select`) and the in-app script
used locally.

## Layout
- **Left: the setlist sidebar.** Setlist name ▾, numbered songs (click one to open it), the select icon, **＋ Song**
  (pick a library song to add after the selected one), the total ("11 songs · 2 breaks · 52:40"). Drag to reorder;
  « hides it. The old Library list below the setlist and the "Drag songs here" area are gone.
- **Centre: Cards / Folders** (top left). The choice is remembered per library.

## Cards
Tabs **Songs · Setlists · Presets** (Presets lists the 8c preset library; a click opens the first song that uses
the preset, where presets are edited). Chips **All · Not in this set**; search covers name, BPM, key, tuning and preset.
4 columns at 1280 px, 5 from 1440 px. A card: colour bar, name, IN SET, a section overview, tuning · tracks · first
preset, BPM · meter · length. Drag a card onto the sidebar: an orange line shows where it lands. Double-click a card,
or click a setlist song, to open that one song's timeline (**← Library**, Esc goes back).

## Folders
One slim row per song: setlist order, then "Not in this set". A row opens inline (its tracks). **One song open at a
time** (on by default) closes the others. **Collapse all** (⌥⌘←).

Speed: opening or closing a row draws only that row (and the one it closes); the other rows stay the same elements.
Measured on the development PC with the real 8-track EIA songs: open 51.5 → 18.4 ms median, close 48.7 → 20 ms, a
zoom frame 44.6 → 10.7 ms. Settings › Diagnostics › "Show timing (9b)" shows the same medians measured on the machine
in use (the Mac).

## Select mode
The select icon (sidebar header or centre toolbar), or Ctrl/⌘-click / Shift-click. A floating bar:
**N selected · Add to setlist · Colour · Duplicate · Export… · Delete · Done**. Delete from the library asks and names
the songs; Delete with setlist rows selected only takes them out of the setlist. Everything undoes.

## Tracks
Right-click a track header: Rename · Colour › · Duplicate track (⌘D) · Move to another song… · Move up / down ·
**Delete track** (⌫). A trash button shows on hover. It asks only for audio recorded in set.Line; undo restores.

## Zoom
⌥ + scroll (or Ctrl/⌘ + scroll, or a trackpad pinch) zooms around the pointer, continuously (one draw per frame).
The song header: **Song · 32 bars · 8 bars · Section**, − slider +, **Fit**. Drag across the ruler to zoom to those
bars (a click still moves the playhead). The section strip in the song header is the overview: a white frame shows
the visible part; drag it to scroll, drag its edges to zoom. Waveforms come from the cached peaks (256 / 1024 / 4096
frames per value).

## Fields from presets
The song's Fields card shows values it inherits from the preset it starts with, greyed, "from preset 17A"; typing
gives the song its own value. A preset change in the middle of a song changes inherited fields from that point: the
band screens' field widget and "Until next change" follow it.
