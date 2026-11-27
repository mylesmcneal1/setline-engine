# Phase 13 · Precision, editing like a DAW, no side panel, and library basics

**Read `docs/daw-conventions.md` first; it governs everything here.** Show machine: the band's 2015 MacBook, macOS 12 (WebKit), 1280×800. Test UI behaviour in the WebKit CI job.

Mockups in `docs/design/phase13/`:
- `pe1.png`: the patch change editor at the bottom
- `mb2.png`: the Song and Track menus
- `si.png`: the Song info window (**ignore its "After this song" control**; see §17)
- `mt1.png` / `mt1-zoom.png`: play / stop / restart in the song and editor headers (the sleek version)

Where mockups show the old top bar or the "Band" tab, follow this spec instead.

---

## A. Precision (do this first; other items depend on it)
### 1. One shared time-to-screen calculation (the root cause)
The user clicks exactly on a beat line and the playhead lands about an 8th note **earlier**. Double-clicking a click note misses it and adds a new note beside it (once the user compensated for the offset, the notes deleted). This isn't caused by text size; the user tested at normal size. Different parts of the timeline compute positions differently.
- **Create ONE module** that converts time ↔ x for a given view (zoom and scroll), and use it for **everything:** ruler ticks and labels, grid lines, lanes, clips, waveforms, notes, sections, markers, tempo / meter points, the playhead, the hover ghost line, the insert line, click and double-click hit-testing, drags, marquee selection, the clip editors, and the overview strip.
- **Delete every other copy** of that maths, including hard-coded offsets, padding fixes, `getBoundingClientRect` arithmetic for time and per-component rounding. Hit-testing reads the pointer position relative to the same element that draws the grid.
- **Draw and hit-test with identical rounding.** The playhead and lines are centred on their time, not drawn from their left edge.
- **Snapping:** on by default, it **rounds to the NEAREST grid line** (the bar by default; Adaptive grid when zoomed in), never down. ⌘-click places exactly under the pointer. The hover ghost line shows the exact landing spot before the click.
- **The sweep test** (WebKit + Windows): for many beats across a song with tempo and meter changes, at several zoom levels, scrolled, in single-song view and in Folders, plus the clip editors:
  - the drawn beat line's centre
  - a synthetic click on that x → the playhead / insert time
  - the hover line

  must all agree within 1 px. Clicking 30 % of the way into a bar lands on that bar's start; clicking 70 % of the way in lands on the next bar.
- **Report** every place positions were calculated differently, and the cause of the 8th-note offset.

### 2. Double-clicking a click note must delete it
After §1, hit-testing uses the shared calculation. **Notes get a hit area of at least 6–8 px** even when drawn as thin ticks, and hovering highlights the note under the pointer. **Single-click selects, double-click on a note deletes it, double-click on empty grid adds one;** the first click of a double-click must never add anything. Test at several zoom levels in WebKit.

## B. Editing like a DAW
### 3. Full clip editing (audio and MIDI)
Conventions §8, completely, for **audio and MIDI clips:**
- select, ⇧/⌘-click, box-select across tracks
- move (snapped; ⌘ for free) along the lane **and to another track of the same kind**; ←/→ nudge
- ⌥-drag copy, ⌘D, ⌘C / ⌘X / ⌘V at the insert line
- **non-destructive trim** of either edge; ⌘E split
- ⌫ / Delete
- **fades** (handles at the top corners of audio clips)
- **clip gain** (drag the clip's level line, or Track › Clip gain…)
- rename (double-click the clip name) and colour
- double-click a MIDI clip to open its editor
- undo for everything

No time-stretching: moved audio plays at its own speed.

### 4. ⌫ / Delete works on anything selectable
**⌫ and forward Delete (fn-⌫)** delete the selection for every selectable type: tracks, clips, notes, sections, markers, tempo / meter points (not bar 1), cues, scene / preset blocks, setlist rows and breaks (removed from the setlist), library songs (deleted, with undo), versions and setlists. Several selected items go in one undo step. **Test each type:** select, ⌫, gone, ⌘Z back.

### 5. The clip editors zoom and scroll on their own
Reverses the earlier "share the timeline's zoom". Like Ableton's detail view:
- **Each bottom editor** (click, MIDI, patch changes) has its own zoom and scroll.
- **On opening,** it frames the range visible in the timeline.
- **A link toggle** (chain icon) in its header ties it to the timeline (off by default).
- **It follows the playhead** inside its own view, with ⌘F applying per view.
- **It uses the shared time-to-screen module** (§1) with its own view parameters.

### 6. The patch change editor at the bottom (mockup `pe1.png`)
**Double-click a modeler / MIDI track** and its editor opens in the same bottom panel as the click editor (one panel; opening another editor replaces it).
- **Rows:** **Preset** (PC + bank bars), **Scene** (coloured blocks), **Footswitch** (ticks), **Other MIDI** (double-click to add any CC, note or program change).
- **Inside the panel,** a scene palette (A–H tiles with the device's names and colours) to drag onto the lane; an orange line shows where it lands.
- **Editing as in the MIDI editor:** select, drag, resize the edges to change when, ⌥-drag to copy, ⌫, Draw mode and grid. **The selected change's details** (name, bars, the exact MIDI sent, e.g. "CC 43 = 2 · ch 1", mode on load) go in the panel's header line or a popover, **not** a side column. Keep the scene palette in the panel.
- **This replaces** the old popup and side-panel modeler editing.
- **Presets are managed here:** pick or rename a preset and edit its scenes (the Presets tab is removed; see §16).
- **The timeline lane** shows scene letters and colours.
- **Its own zoom** (§5), and play / stop / restart in its header (§21).

### 7. A song's editors close with the song
Collapsing a song in Folders, closing it, ← Library / Esc, switching songs, or switching to Perform / Remote closes that song's bottom editor and any popovers. Reopening the song restores the editor at the same zoom and scroll.

## C. Look and feel
### 8. Drag and drop looks right
Today, dragging a song card shows a long see-through rectangle. **For every drag** (song cards, setlist rows, breaks, Folders rows, track headers, section blocks, clips, notes, MIDI patch / scene blocks):
- **A compact, solid drag chip follows the pointer** with a soft shadow. A song shows its colour bar, name and length (about setlist-row size); a block shows itself at its true size. **Correct at any text size.**
- **The source dims** in place.
- **Lists open a gap** where the item will land, as well as the landing line. **Timelines** show the landing line from §1.
- **Dropping slides into place; cancelling** (Esc or an invalid drop) slides back.
- **One shared drag helper** with pointer events (as in 10a).

### 9. Zoom polish
Zooming works much better but still looks jumpy:
- **Crossfade from the stretched snapshot to the sharp redraw** over about 80 ms instead of swapping.
- **Keep the anchor point under the fingers / pointer perfectly still** through the swap, at any text size (fix the 120 % anchor drift noted in Phase 12).
- **Stretch at sub-pixel precision.**

### 10. A colour wheel everywhere
**Replace preset colour swatches** with a colour popover: a colour wheel, a brightness slider, a hex field, and a row of recently used colours. Use it everywhere a colour is chosen: songs, tracks, sections, clips, scenes, breaks, setlists and the Customize accent. **Text on coloured blocks switches black or white automatically** for contrast. Applies to several selected items at once, with undo.

### 11. Play / stop / restart while editing (mockup `mt1-zoom.png`, the sleek version)
**The top bar is unchanged** (no transport buttons there).
- **In the open song's header** (next to the title), and **in each bottom editor's header:** a thin **restart** icon (back to bar 1 and play), a **small round play–stop button** with a soft green ring when playing (grey when stopped), and the current bar in grey. No box around the group.
- **Play starts** from the insert line, or where it stopped. In Folders, the group appears on each open song's header.
- **Keys:** Space play / stop · ⇧Space play from the insert line · ⌥Space restart from bar 1 · ↩ back to the start (as now).

### 12. "Band" becomes "Remote"
**The tabs are Show · Perform · Remote** (View › Remote, ⌘3). Rename "band screens" to **"remote screens"** everywhere: menus, Settings, the first-run checklist, ⌘K, tooltips, help, the glossary and the page title the phones and tablets open ("set.Line Remote"). Pairing, layouts and existing paired devices keep working.

## D. No right-side panel
### 13. Remove the right side panel (mockups `mb2.png`, `si.png`)
**The setlist sidebar on the left stays.** The right panel and its toggle (View › Side panel, ⌥⌘R) go, and the timeline gets the width.
- **Song menu** (the open song):
  - Song info… (**⌥⌘I**), Rename, Colour, Key
  - Versions, New version
  - Add section / time signature / tempo change, Make sections from cues…
  - Song fields ›, Notes for the band…
  - Add to setlist, Delete song
  - **No "After this song"** (§17)
- **Track menu** (the selected track):
  - Rename, Colour, **Output ›** (checkmark list), Height, Mute, Solo
  - **MIDI:** Device ›, Port & channel ›, Edit patch changes…
  - **Clip:** Clip gain…, Fades ›, Split
  - Add audio / click / MIDI track, Duplicate, Delete
- **The Song info window** (⌥⌘I, `si.png`) has tabs:
  - **General:** name, colour, tempo at bar 1 (+ the number of changes), key, count-in, fields line
  - **Versions**
  - **Fields**
  - **Notes**
- **Breaks** are edited in a popover from their setlist row (and the Setlist menu).
- **Track header controls,** in-place renaming, right-click, ⋯ and ⌘K stay as other ways in.
- **Report:** list everything the right panel did and where each item now lives.

### 14. Song transitions belong to the setlist
**"After this song" (Stop / Segue / Auto-next) is a property of a song's entry in a setlist,** not of the song. The same song can segue in one setlist and stop in another.
- **A small connector between setlist rows** shows the transition; clicking it cycles or opens the choice.
- **Setlist menu › After this song ›** for the selected row; also in the row's right-click.
- **Migrate** each song's current setting onto each setlist entry that uses it.
- **Perform, remote screens and the backup rig** read it from the setlist.
- **Count-ins stay with the song** (the user's call; it can change later if feedback says so).

### 15. Songs / Setlists tabs in both views; Presets removed
**Cards and Folders both get Songs · Setlists tabs** (the Presets tab is removed from both). In Folders:
- **Songs:** the folder rows
- **Setlists:** one row per setlist (name, song count, total time), expanding to its songs and breaks

The chosen tab stays when switching views. **Presets still exist** and are managed in the patch change editor (§6), ⌘K and right-click.

## E. Cues
### 16. Remove the computer's system voices
Remove macOS / Windows system speech (AVSpeechSynthesizer / SAPI) from cues: the voice lists, Settings and code. **Cues come from the user's recordings or the downloaded natural voices** (Kokoro). Songs that used a system voice switch to a natural voice chosen once (or recordings where they exist), with an undo note. Keep "Record new…".

### 17. A global Cues menu in the menu bar
A new **Cues** menu (between Setlist and Customize):
- **Voice ›:** Your recordings / a natural voice / recordings first, a natural voice for the rest
- **Announce ›** (checkmarks): section names, count-ins, next song name, breaks
- **Count-in ›:** off / 1 bar / 2 bars; before songs / before every section
- **Output ›** and **Level…**
- **Cue words…:** one window listing every word (preview ▶, re-record, rename, add or remove)
- **Record missing words…**

**These apply to every song.** Remove the per-song cue settings from the song settings. **Each song keeps where its cues fall** (from its sections and imported cues). The editable cue clip stays parked.

### 18. The sections-from-cues prompt goes away once applied
Once sections from cues have been applied to a song (or the song has any sections), its suggestion bar, ghost sections and "✨ Sections from cues" prompt never show again, across relaunches and updates, unless all its sections are deleted or the apply is undone. It can still be run on purpose from Song › Make sections from cues…, ⌘K or the Sections row's right-click.

## F. Library basics
### 19. Save Library
- **File › Save Library (⌘S)** saves everything in the open library: every song (versions, tracks, clips, cues, sections, MIDI), setlists, breaks, presets and settings. **Autosave stays** as a safety net.
- **A visible save state:** the window title and the File menu show "Saved" or "● Unsaved changes". Quitting with unsaved changes asks Save / Don't Save / Cancel.
- **File › Save Library As…** saves a full copy to a new location.

### 20. Remove example data; first launch opens a blank library
- **Remove all demo / example content from the app** (Neon Rivers, Glasshouse, Low Tide, Satellites, Copper Sun, Fall Tour, etc.).
- **On update,** remove from the user's libraries **only items marked as example data**, never anything the user imported or made. Show a one-time note with undo.
- **A fresh install's first launch** creates and opens a **blank library** with the first-run checklist.
- **Delete Claude Code's own test libraries** in the temp folder (e.g. "EIA 9a Test", "EIA 10c Test") once tests no longer need them, and make tests clean up after themselves.

### 21. A Key Commands window (Mac and Windows)
- **Opened from** Edit › Key Commands… (⌥⌘K / Ctrl+Alt+K); Help › Keyboard shortcuts opens it too. It replaces the read-only ⌘/ sheet (⌘/ opens this window).
- **Every command,** grouped (Playback, Editing, Timeline, Clips, MIDI, Setlist, View, Cues, Window), **searchable** by name or key, showing **Mac and Windows keys side by side.**
- **Remapping:** select a command, press a new key, see a clash warning, then save. Reset one or all.
- **Presets:** set.Line default, Ableton-style, Logic-style (where they differ).
- **Export / import** (JSON) and **Print** a cheat sheet.
- **The menu bar, tooltips and ⌘K** always show the current keys. Stored per computer.

---
## Report
- the manual test list (max 25, mark [MAC])
- **§1:** every place positions were calculated differently, and the cause of the 8th-note offset
- where each right-panel feature now lives (§13)
- what example data was removed (§20)
- every changed or new shortcut
- any decisions that differ from this spec or the conventions guide
