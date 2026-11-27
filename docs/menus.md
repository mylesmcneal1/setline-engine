# Menus, ⌘K and the visible behaviours (10b)

Code: `ui/public/menus9.js` (the menu bar, the object menus, the shortcuts), `ui/public/ix10.js` / `ix10.css`
(⌘K, the ⌘/ sheet, grips and ⋯, the selection bar, tooltips, undo notes, first run), `ui/src/words.ts` (the
glossary), `app-gui/AppMenus.*` (the native menu bar). Tests: `tests/ui-10b.js` (Chrome and WebKit), the in-app
menu test (every item chosen through the native menu path arrives once), `set.Line --menu-test`.

## Principles
1. Visible, not remembered: what you can do with something is on it (a grip, ⋯, a hover hint) or in the
   selection bar. Nothing is only on right-click.
2. Four ways to every action: the menu bar, right-click, ⋯ and ⌘K. They are the same items, with the same names,
   built once (`SLMenus.objItems`).
3. Same words everywhere (`ui/src/words.ts`): Song, Version, Section, Cue, Click, Track, Setlist, Break, Library,
   Preset.
4. Every change says what happened, with Undo.
5. Empty places say what goes there, with the one click to fill it.
6. Mac and Ableton conventions: double-click renames, ⌘D duplicates, ⌫ deletes, Space plays, Esc cancels.
7. Safe on stage: while playing (or with Perform locked) the destructive items are greyed out; notes are logged,
   not shown, during a show.

## The menus
- **set.Line** (Mac): About set.Line · Check for updates… · Settings… ⌘, · Audio & outputs… · MIDI & controllers… ·
  Hide · Quit. On Windows, Settings / Audio & outputs / MIDI & controllers / Exit are in File, and About / Check
  for updates in Help.
- **File:** New song… ⌘N · New setlist ⇧⌘N · Import: Ableton project… ⌘I, Audio as a new song…, set.Line package
  (.setline)… · Export: This song… ⌥⌘E (12: ⌘E is Split), This setlist… ⇧⌘E · Print setlist… ⌘P · Backups… · Clean up unused audio…
- **Edit:** Undo ⌘Z · Redo ⇧⌘Z · Cut ⌘X · Copy ⌘C · Paste ⌘V · Duplicate ⌘D · Split ⌘E (12) · Delete ⌫ · Rename… ↩ · Edit… · Select all ⌘A ·
  Select songs ⇧⌘S · Search or do anything… ⌘K
- **Library:** Switch library › · New library… · Rename library… · Delete library › (11: any library but the open one) · Show in Finder / Explorer · Merge as versions… ·
  Unmerge version · Sort by › (Name, Recently added, Length)
- **Song:** Rename song… · Colour › · Duplicate song · Delete song… · Versions › · Edit version › · Markers › · Tempo changes › · Time signatures › (11: each with its own Rename / Edit / Delete) · New version · Add section ⌥⌘S ·
  Add time signature… ⌥⌘M · Add tempo change… ⌥⌘T · Make sections from cues… · Add to setlist ⇧⌘A · Sort tracks:
  MIDI to the bottom
- **Track:** Add audio track ⌘T · Add click track · Add MIDI track · Rename track… · Colour › · Duplicate track ·
  Delete track · Move up ⌥↑ · Move down ⌥↓ · Height › · Edit click (MIDI clip)
- **Setlist:** Switch setlist › · Add song… · Add break ⌘B · Move up ⌥↑ · Move down ⌥↓ · Remove from setlist · Rename
  setlist… · Duplicate setlist · Delete setlist (11: undo instead of a question; the last one too)
- **View:** Show ⌘1 · Perform ⌘2 · Band ⌘3 · Cards ⌥⌘1 · Folders ⌥⌘2 · Collapse all ⌥⌘← · Zoom › (Zoom in ⌘=,
  Zoom out ⌘−, Whole song, 32 bars, 8 bars, Section) · Track height › (Mini … Huge, Shrink tracks ⌥⌘−, Grow tracks
  ⌥⌘=, Fit tracks to window ⇧⌥⌘F, Compact top rows) · Fit all ⌥⌘F · Follow playhead ⌘F (12) · Setlist sidebar ⌥⌘L · Side panel ⌥⌘R
- **Customize:** Theme › · Accent colour › · Fonts › · Text size › · Transport style › · Customize the look… ⌥⌘, ·
  Reset to default
- **Window:** Minimise ⌘M · Full screen ⌃⌘F
- **Help:** Quick start · Keyboard shortcuts ⌘/ · Diagnostics · Copy diagnostics · Report a problem…

The app's menu bar shows (and on the Mac answers) the keys with ⌘ / Ctrl and ⌥↑ / ⌥↓. ↩ and ⌫ depend on what's
selected, so the page alone answers them; the page's own menus, ⌘K and the ⌘/ sheet show them. Every key a menu
shows works while the page has focus (one dispatcher in `menus9.js`), and the page takes it first, so a Mac key
equivalent never fires twice. In a text field, ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z stay the text field's own; choosing Edit ›
Copy etc. with a text field focused does the text edit (on the Mac: the standard action, sent by the app).

## Right-click = ⋯ = the menu bar
- **Song** (card, Folders row, setlist row): Open · Rename… · Colour › · Duplicate · Versions › · Add to / Remove from
  the setlist (in the setlist: Move up / down, After this song…) · Make sections from cues · Delete song…
  Several selected: Add to / Remove from the setlist · Make sections from cues · Merge as versions… · Delete N songs…
- **Break:** Edit break… · Label › · Move up / down · Duplicate · Remove (while it runs: Skip it now)
- **Track header:** Rename… · Colour › · Duplicate · Move up / down · Move to another song… · Height › · Delete track
- **Section:** Rename… · Colour › (its type) · Loop until released (vamp) · At its end › · Duplicate · Split at
  playhead · Delete
- **11: everything else** (see docs/edit-anything.md): a version (its row, or the setlist row's “Album ▾”), a marker,
  a tempo point, a time signature, the setlist name, a preset, a cue word: right-click, ⋯ where it has a row, Edit ›
  Rename… / Edit… / Delete on the one clicked last, and ⌘K by name (“delete click”, “rename verse”).

## The eight visible behaviours
1. **⌘K: search or do anything.** The search pill in the top bar or ⌘K: songs, setlists, every menu action with its
   key ("Make sections from cues · this song"), settings pages and help topics. Nothing typed: recent songs and your
   most-used actions. Matching: the text anywhere, or its letters in order at word starts ("msc"). ↑↓, ↩, Esc.
2. **A grip ⋮⋮ and ⋯ on hover** (and on keyboard focus) on setlist rows, cards, Folders rows, track headers and
   sections.
3. **Double-click a name to rename it**, ✎ on hover (10a).
4. **The selection bar** over the timeline or the cards: a song: Rename · Colour · Versions ▾ · ✨ Sections from cues
   (when it has cues) · Add track ▾; a track: Rename · Colour · Height ▾ · Delete; several songs: the 9b bar.
5. **Empty places teach:** an empty library shows the first-run checklist; an empty setlist "Drag songs here from
   the cards · ＋ Add song". (10c: ghost sections from cues, "No click in this song · Fill from time signature".)
6. **Tooltips with keys** after ~500 ms (and on keyboard focus): "Play  Space".
7. **Landing lines** while dragging: orange in the setlist, blue for tracks (10a).
8. **An undo note after every change:** "Moved “TRAX” to the top · Undo ⌘Z", about 5 s, the newest replaces the
   last. A change without its own note gets one from what changed ("Edited the sections of “Glasshouse”"). Never
   during a show: in Perform while playing it goes to the log.

## First run and Quick start
An empty library shows: Pick your audio interface (ticked when one is found) · Bring in your songs (Import
Ableton…) · Check the click and cues (ticked after the first Play) · Build a setlist · Connect the band's screens
(Show QR), and "Drop an Ableton project (.als) or audio files anywhere on this window". Hide dismisses it;
Help › Quick start shows it again.

## The ⌘/ sheet
Searchable, grouped (Playback · Editing · View · Setlist · Library · Help), made from the menus' own keys plus the
page's single keys (Space, N, P, V, C, K, L, [, ], = −, ⌥ scroll, ↩, ⌫, ⌥↑ ⌥↓, Esc), so it can't go stale.

## 12: keys added with the conventions guide (docs/daw-conventions.md, docs/daw-audit.md)
- Timeline: = / − zoom around the playhead · Z zoom to the selection · ⇧Z or X back · ⌘F Follow · ⌘E Split at the
  insert marker (a click in a lane) or the playhead · ↩ renames the selected track / section / marker · ⇥ while
  renaming: the next name · ⇧ / ⌘-click track headers: several · ⌘-click S: solo only this
- Ruler: click (nearest beat; ⌘ free) · drag up / down zooms, sideways scrolls · double-click Fit
- Lists: type letters to jump · ↑ ↓ move the selection
- Click editor: double-click adds / deletes a note · B Draw mode (⌥-drag erases, Esc leaves) · ← → nudge (⇧ a bar) ·
  ↑ ↓ the other row · ⌘C / ⌘X / ⌘V (at the insert marker) · ⌘D · ⌘A · ⌘1 / ⌘2 grid narrower / wider · ⌘3 triplets ·
  ⌘4 snap · ⌫ · Esc
