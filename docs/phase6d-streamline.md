# Phase 6d: Streamline (track headers, routing on tracks, colours, cue phrases, fewer menus)

The user's notes from 24 Nov 2026, turned into one spec. Mockups are in `docs/design/streamline/`:
- `proposed.html` (open it in a browser; the bottom of the file has helper functions such as `openOut(2)`, `openSw(3)`, `openSettings('out')` and `band(true)` that show each state)
- PNG screenshots `01`–`08`, plus `00a/00b` showing the current app for comparison
- `09-walkthrough.mp4`

**Guiding rule from the user:** set.Line is for playing live. Anything that wouldn't get used at a gig goes, or moves out of the way. Fewer menus. Routing happens on the tracks, like a normal DAW.

**Still true from earlier phases. Do not break any of these:**
- stems are never resampled
- atomic saves
- single instance
- copy-only drops
- the peaks cache stays out of the stems folders
- listen mode
- Dark/Darker appearance
- Ctrl/⌘ shortcut labels

---

## 1. App icon on the taskbar, window and Alt+Tab (Windows)

The taskbar still shows Windows' generic icon.
- Make sure the .exe embeds `assets/brand/setline.ico` through a resource file. It needs all sizes (16/20/24/32/40/48/64/256).
- Set the window icon at runtime with the peer icon / `WM_SETICON` big+small, so it shows in the title bar, taskbar and Alt+Tab.
- If the app sets an explicit AppUserModelID, make it consistent so the taskbar doesn't group the app under a generic icon. A pinned shortcut needs the same ID.
- On Mac, check the Dock icon uses the .icns.
- Verify by looking at it, not just by building. Clear the Windows icon cache if needed (`ie4uinit -show`).

## 2. Track headers: "console strip" (mockup 01)

Each header is about 300 px wide and 50 px tall. Left to right:
1. **Colour tab**, 5 px, the full height of the row. Click it to open a 12-swatch popover (mockup 03). The track's clips use the track colour.
2. **Type icon** in the track colour: click, cues, audio wave, or MIDI.
3. **Name.** Double-click to rename.
4. **Output chip**, e.g. "FOH L/R ▾". It shows the renamed output (section 4). Click it to open the output menu (mockup 02) with these groups:
   - Stereo pairs
   - Mono outputs
   - None
   - "Rename outputs…", which opens Settings → Outputs
   On a MIDI track the chip shows "Port · Ch N" and opens the port/channel picker.
5. **Thin fader**, always visible. Double-click resets it to 0 dB. Alt/Option-drag gives fine control.
6. **M / S buttons.** MIDI tracks get M only.
7. **Meter**: a thin peak meter, post-fader, fed by the engine's real levels (not decorative). Not shown on MIDI tracks.

Click a header to select the track. That opens the right panel for the track (section 6).

**The track-add row under the last track:** "+ Audio track", "+ Click track", "+ MIDI track". Several click tracks are allowed, e.g. a different click for the drummer on another output.

## 3. Routing moves onto the tracks. The Outputs & MIDI page is removed.

- **Remove the "Outputs & MIDI" page and its routing matrix.** Each track has one output, set from its header or the right panel. Tracks sent to the same output are summed by the engine.
- **Remove buses.**
- **Remove the template vs per-song overrides concept.** Each song's tracks just have outputs.
- **Defaults for a new track:** reuse the output that a track with the same name last used anywhere in the show. If there isn't one, use the next free output. If none is free, use Main/Out 1–2.
- **Migrating existing shows on open:**
  - A per-song override wins; otherwise use the template's assignment.
  - If a track fed several outputs, keep the first output and log the rest.
  - If a track fed a bus, route it to the bus's first output.
  - Save the migrated show in the new format.
  - Old shows must still open.
  - Add a test for this migration.
- **The "Export patch sheet (PDF)" moves** to Settings → Outputs. It lists outputs by name and which tracks use each one.
- **Stem options that were on that page:**
  - Delete the "Resample if file rate ≠ engine rate" toggle if it exists in the real code. Stems are never resampled. The behaviour stays: warn on import.
  - Delete the time-stretching "NEVER" badge. It's a rule, not a setting.
  - The length-mismatch check stays as the import warning, not as a toggle.

## 4. Settings sheet (mockups 05–07)

One sheet, opened with the ⚙ button in the top bar, File → Preferences…, or Ctrl+, / ⌘,. It has a left nav and a content area. These settings belong to this computer (the rig), not the show, unless noted.

- **Audio**
  - device, driver, sample rate, buffer
  - stat tiles: output latency, audio load, dropouts this show
  - Listen on this computer: device and "what you hear". This moves here from the top-bar ▾ menu; the Show outputs / This computer toggle stays in the top bar.
  - "If the interface disconnects": the existing behaviour, made visible
- **Outputs**
  - Rename each interface output (stored per device name, so a different interface keeps its own names).
  - Show stereo pairs (odd/even).
  - Export patch sheet PDF.
  - The output chips and menus everywhere use these names.
- **MIDI**
  - The list of MIDI ports, each with the number of tracks using it.
  - "Send MIDI early by" (the existing offset).
  - **"Patch name lists"**, optional (see section 9).
- **Voices**: Kokoro download/status and the default cue voice. This moves here from wherever it lives now.
- **Folders**: the shows/library locations, and "Open logs folder".
- **Appearance**: Dark/Darker.
- **Diagnostics**: Copy diagnostics, Save diagnostics…

**Top bar status pill:** keep ONE pill, e.g. "iD14 · 48k · 128" with a dot.
- The dot turns red on a dropout or disconnect.
- Clicking the pill opens Settings → Audio.
- Remove the other status pills (engine running, rig, dropouts) and fold them into this one.

## 5. Song colours and track colours

- **Songs:** right-click a song in the setlist → Colour ▸ → a 12-swatch popover (mockup 04).
  - The colour shows as a 3 px bar in the setlist row and beside the song title in the song header.
  - New songs get the next palette colour.
  - It's saved in the show and later used on band screens.
- **Tracks:** set from the colour tab (section 2) or the right panel. Saved per track.
- The palette is the 12 colours in `proposed.html` (`PAL`).

## 6. Right panel = the selected thing

Clicking a track opens its settings here. This replaces the separate floating panels for click and cues, so there's one place.
- **Every track** gets a "Track" card: colour swatches and output.
- **Click track** also gets a "Click sound" card:
  - sound
  - beat 1 accent / same
  - accent level, beat level
  - off-beats (off / 8ths / 16ths)
  - "Same click for every song" (the existing "use the set's click")
- **Cues track** also gets a "Voice" card:
  - voice, speed
  - Edit phrases… (section 7)
  - Pronunciations… (collapsed)
  - recorded words
- **Audio track** also shows gain and the file name/rate.
- **MIDI track** also shows port, channel, patch name list (None by default), and Edit MIDI…, which opens the bottom MIDI drawer for events only.
- At the bottom of every panel: "Delete track…".
- **When nothing is selected,** the right panel shows the Song: versions, key, tempo map.
- Clips, sections, cues and multi-selections keep their current panels.

## 7. Cue phrase picker

Typing "1 2 3 4" for every count-in is annoying, so:
- **Double-click on the Cues lane** opens a small picker at that spot (snapped to the grid). It has three parts:
  - **Count-ins** (top): presets like "1 2 3 4", "1 2 3", "1 2", "5 6 7 8". One click places one cue per beat starting at that beat. The meter decides the default count.
  - **Phrases**: the saved phrase list, most-used first, e.g. Verse, Chorus, Bridge, Pre-chorus, Tag, Outro, Breakdown, Build, Drums in, Last time, Hold, Big ending.
  - **Search/type field**: filters as you type. Enter places a new phrase and adds it to the list.
- **"Edit phrases…"** edits the phrase list. The list is stored in the Library, so it's shared by all shows. You can add, rename, delete and reorder.
- It works with recorded cue words as well as synthesized voices.
- **Nothing automatic.** Don't generate cues from section names. The user places every cue.
- The right-click "Add cue here…" item opens the same picker.

## 8. Menu and UI cuts (the "too many menus" review)

**Top level.** Use three tabs everywhere, in the same order: **Show | Perform | Band**.
- The arrange page currently shows 3 tabs while the other pages show 5. Make them consistent.
- **Band** replaces both "Satellite" and "Users & Canvases" (mockup 08). For this phase, only build the page shell:
  - the list of screens
  - layout preset cards (Count & sections / Setlist / Controls)
  - "Shown on this screen" toggles
  - "Can control" toggles
  - device name/colour
  Reuse the existing data where it already exists. The real satellite work is a later phase, so don't build networking for it now.
  - The per-user widget canvas editor goes behind "Customize layout…" on that page. It is not a separate tab.

**Cut from the Show view:**
- The open/save icon buttons beside File (use File / Ctrl+S).
- The pointer/scissors tool modes. Keep one pointer; split with S or right-click → Split at playhead.
- The ✂ ⧉ ⎘ ⊕ icon buttons in the toolbar. Their actions stay on right-click and shortcuts.
- The Mixer button and Mixer drawer, and the Song panel's "Levels → Open mixer" card. The header faders replace them. Keep any mixer-only functionality by moving it into the track's right panel.
- The Song panel's "Routing" card (it duplicated routing).
- In the section panel: "Satellite: show as tile / hide from tiles". This goes to Band later. Leave the data field alone.
- In the MIDI drawer: port/channel/device fields (they now live on the track). The drawer is for events only.

**Keep:**
- File menu, transport, position/BPM, the Show outputs / This computer toggle
- undo/redo, Snap, zoom, + Track, + Song
- the setlist with "Not in this set"
- the tempo lane and the tempo map (the tempo map table goes in the Song panel)
- the sections lane

**Rule:** if you find another control that duplicates one of these places, remove the duplicate and list it in your report. Don't remove anything else without listing it.

## 9. MIDI is generic

The Quad Cortex and Axe-Fx are only examples. Any MIDI device on any port and channel must work.
- Send Program Change, Bank Select, CC and notes.
- **Patch name lists are optional:**
  - A list maps numbers to names so clips can say "Prog 12 · Lead".
  - The default is None, and clips show numbers.
  - Any built-in device profiles become optional name lists in Settings → MIDI → Patch name lists.
  - Remove any UI or wording that assumes a specific brand.
- The mockup shows a "Guitar rig" on USB MIDI Ch 1 and "Lights" on loopMIDI Ch 16 as examples.

---

## Done when

- Everything builds on Windows. CI is green on Windows and Mac. The core tests pass, plus the new migration test.
- An old show opens, migrates, saves, and reopens identically.
- The icon shows correctly on the taskbar, title bar and Alt+Tab. Check it visually.
- The report back gives:
  - a short manual test list (numbered, at most 15 items)
  - everything removed (section 8 list + anything extra)
  - anything you decided differently from this spec, and why
