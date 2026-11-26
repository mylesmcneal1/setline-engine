# Phase 10b · Menus reorganised, and making set.Line intuitive

The user: "Overall I want everything to be more intuitive." "Things that should be obvious when it comes to menu nav are not."
Mockups in `docs/design/phase10/`:
- `n1-menus.png`: the new menus
- `ix1.png`: the eight intuitive behaviours, numbered on the main screen
- `ix2.png`: first run, empty states, ⌘K and the ⌘/ sheet

## Principles (check every screen against these before shipping)
1. **Visible, not remembered:** anything you can do with an object is visible on it (grip, ⋯, a hover hint) or in the selection bar. Nothing is only on right-click.
2. **Four ways to every action:** the menu bar, right-click, the ⋯ button and ⌘K. They're the same items with the same names.
3. **Same words everywhere:** keep one glossary (`ui/src/words.ts`) and use it in menus, buttons, tooltips, the band screens and docs. Song, Version, Section, Cue, Click, Track, Setlist, Break, Library, Preset.
4. **Feedback and undo:** every change shows a short note with Undo; long work shows progress.
5. **Empty places teach:** every empty list or lane says what goes there and offers the one click to fill it.
6. **Conventions:** behave like Ableton and the Mac (double-click to rename, ⌘D duplicate, ⌫ delete, Space play, ⌥-drag copy, Esc cancel).
7. **Safe on stage:** while playing, destructive actions are disabled or ask first, and Lock (7c) blocks editing.

## 1. Menus (as in `n1-menus.png`)
Rebuild `ui/public/menus9.js` to this structure. On the Mac, the app menu holds About / Check for updates / Settings…; on Windows those go in File and Help.
- **set.Line (Mac):** About · Check for updates… · Settings… ⌘, · **Audio & outputs…** · **MIDI & controllers…** (open those Settings pages directly) · Hide · Quit
- **File:**
  - New song… ⌘N · New setlist ⇧⌘N
  - **Import:** Ableton project… ⌘I · Audio as a new song… · set.Line package (.setline)…
  - **Export:** This song… ⌘E · This setlist… ⇧⌘E
  - Print setlist… ⌘P
  - Backups… · Clean up unused audio…
- **Edit:** Undo · Redo · Cut · Copy · Paste (with their keys on the Mac too, without breaking text fields) · Duplicate ⌘D · Delete ⌫ · Rename… ↩ · Select all · Select songs ⇧⌘S
- **Library** (new): Switch library › · New library… · Rename library… · Show in Finder/Explorer · Merge as versions… · Unmerge version (10c) · Sort by ›
- **Song:**
  - Rename song… · Colour › · Duplicate song · Delete song…
  - Versions › · New version
  - Add section ⌘⌥S · Add time signature… ⌘⌥M · Add tempo change… ⌘⌥T
  - Make sections from cues… (10c)
  - Add to setlist ⇧⌘A · Sort tracks › MIDI to the bottom
- **Track** (new):
  - Add audio track ⌘T · Add click track · Add MIDI track
  - Rename track… · Colour › · Duplicate track · Delete track
  - Move up ⌥↑ · Move down ⌥↓ · Height ›
  - Edit click (MIDI clip) (10c)
- **Setlist:**
  - Switch setlist › · Add song… · Add break ⌘B
  - Move up / Move down / Remove from setlist
  - Rename setlist… · Duplicate setlist · Delete setlist…
  - Print setlist…
- **View:**
  - Show / Perform / Band (⌘1–3) · Cards / Folders (⌘⌥1/2) · Collapse all
  - Zoom › · Track height › · Fit all ⌘⌥F
  - Setlist sidebar · Side panel
- **Customize:** Theme › · Accent colour › · Fonts › · Text size › · Transport style › · Customize the look… · Reset. **Remove "Density",** which duplicated View › Track height.
- **Help:** Quick start · Keyboard shortcuts ⌘/ · Diagnostics · Copy diagnostics · Report a problem…
- **Remove the duplicates:** "Open recent" (Switch library covers it), and Add break / Print in File.
- **Fix:** "Import audio files…" must import audio as a new song, not open New song. Rename it to match.
- **Shortcuts:** every shortcut shown must work, with no clashes. List them all in the report.

## 2. Right-click menus = the ⋯ button = the menu bar
Build them once per object and use them everywhere:
- **Song** (card, Folders row, setlist row, song header): Open · Rename… · Colour › · Duplicate · Versions › · Add to setlist / Remove from setlist · Make sections from cues · Delete song…
- **Break:** Edit break… · Label › · Move up / down · Duplicate · Remove
- **Track header:** Rename · Colour › · Duplicate · Move up / down · Height › · Delete track
- **Section:** Rename · Colour › · Loop / Vamp · Duplicate · Delete
- **Clip, cue, preset / scene block:** their existing actions, in the same style

## 3. The eight visible behaviours (`ix1.png`)
1. **⌘K: search or do anything.**
   - A search pill in the top bar plus ⌘K open one palette with songs, setlists, actions (with their shortcuts), settings pages and help topics.
   - With nothing typed it shows recent songs and frequent actions.
   - Fuzzy matching; arrow keys and ↩; context-aware ("Make sections from cues · this song").
   - The 9b ⌘K song search becomes part of this.
2. **Hover shows a grip and ⋯:** setlist rows, cards, Folders rows, track headers and sections show a grip (⋮⋮) and a ⋯ button on hover, and on focus for keyboard users.
3. **Double-click any name to rename it,** with ✎ on hover (from 10a).
4. **A selection bar:** a slim bar above the timeline (or above the cards) shows the main actions for what's selected. It changes with the selection and is hidden when nothing is selected.
   - **A song:** Rename · Colour · Versions ▾ · Sections from cues · Add track ▾
   - **A track:** Rename · Colour · Height · Delete
   - **Several songs:** the 9b bulk actions
5. **Suggestions instead of empty space:**
   - Ghost sections from cues with "Make these N sections" / "Edit…" (10c).
   - "No click in this song · Fill from time signature".
   - An empty setlist: "Drag songs here · + Add song".
   - An empty library: the first-run checklist (section 4).
6. **Tooltips with shortcuts:** every icon button shows a tooltip after about 500 ms: its name plus its shortcut. It also shows on keyboard focus.
7. **A landing line when dragging:** orange in the setlist, blue for tracks (from 10a).
8. **An undo note after every change:**
   - A small note at the bottom: "Moved TRAX to the top · Undo ⌘Z". It stays about 5 s; the newest replaces the older ones.
   - **Never during a show:** hidden in Perform while playing, and logged instead.

## 4. First run, Quick start and the ⌘/ sheet (`ix2.png`)
- **An empty library shows a checklist:**
  1. Pick your audio interface (ticked automatically when found)
  2. Bring in your songs (Import Ableton… / drop files)
  3. Check the click and cues
  4. Build a setlist
  5. Connect the band's screens (QR)

  Each step has one button. Steps tick themselves off when done. **Help › Quick start** reopens the checklist any time; "Hide" dismisses it.
- **A drop zone:** "Drop an Ableton project (.als) or audio files anywhere on this window."
- **The ⌘/ shortcut sheet:** searchable, grouped (Playback / Editing / View / Setlist), generated from the same command list as the menus so it never goes stale.

## 5. Wording pass
Go through every visible string. Use the glossary words; no internal jargon ("pack", "pads", "lane id"…). Buttons say what they do ("Make these 8 sections", not "OK"). Report the strings you changed (a short list).

## Tests
- **Menus:** every item fires exactly once (extend `--menu-test`) and every shown shortcut works.
- **⌘K:** finds an action, a song and a setting.
- **Behaviours:** grips and ⋯ appear on hover and focus; the selection bar shows the right actions per selection.
- **Undo notes** appear and undo works; tooltips show their keys.
- **First run** shows on an empty library.
- **All of the above in WebKit.**
