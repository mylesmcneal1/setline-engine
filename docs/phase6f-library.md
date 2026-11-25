# Phase 6f: The Library replaces Shows

Do this after 6d and 6e, and before 6g.

Mockups are in `docs/design/library/`: `library.html`, PNGs `l1`–`l7` (Library panel, setlist picker, File menu, migration, import merge, MIDI settings, Sync MIDI) and `l8-library-walkthrough.mp4`.

The user's model: set.Line lives on the band's own playback Mac as a **master bank of all the band's songs**, with every version. Nothing needs "loading". A gig or practice is just a setlist picked from that bank.

**This replaces "Shows":**
- no Open/Save/Save As of shows
- the Shows folder is retired after migration
- everything that said "per show" in 6d/6e now means per Library or per setlist, as listed below

**Still true. Do not break any of these:**
- atomic saves
- single instance
- automatic backups
- no resampling
- copy-only drops
- fast audio copy on import
- the peaks cache stays out of the audio folders
- Clean up unused audio

---

## 1. Where things live

| Belongs to | What |
|---|---|
| **Library** | songs (source arrangement, versions, stems, cues, MIDI, sections, colours), song field definitions and values, the cue phrase list, patch name lists, band screens/dashboards |
| **Setlist** | ordered entries (song + chosen version + "after this song"), name, colour, MIDI sync point (6g), curfew time (6g) |
| **This computer** | audio device/driver/rate/buffer, output names, listen mode, appearance, last-opened library + setlist |

## 2. Storage

- **Location:** `Documents/set.Line/Libraries/<Library name>/`. The default Library is called "My Library" and can be renamed.
- **Layout:** use the layout you think is most robust. Suggested:
  - `library.json` (index, fields, dashboards)
  - `songs/<songId>/song.json`, one file per song, so saves are small and a bad write only touches one song
  - `setlists/<setlistId>.json`
  - `audio/`, where files are stored by content hash, so the same file imported twice is stored once
- All paths inside are relative, so a Library works on both Windows and Mac.
- **Autosave:** every change is written atomically, debounced about 1 s. There is no Save command. The title bar shows "Saved" or "Saving…".
- **Backups:** reuse the existing automatic backups, now at Library level (on launch, plus at a regular interval; keep the last N). File → Backups ▸ lets you restore one, either into a new Library or by replacing the current one, with a confirm.
- **Undo/redo** work as now.

## 3. Launch and the left panel

- **On launch:** opens the last Library and last setlist. Settings → General → "On launch: Last setlist / Empty setlist".
- **The left panel, top to bottom:**
  - **Setlist picker:** a dropdown of all setlists with colour bars, plus "New setlist" (empty), "Duplicate", "Rename", "Delete…".
  - **The set's songs:** stacked version cards (6e), transitions, total time.
  - **Library:** every song, with a search box and sort (A–Z, recently added, length), and a filter by song field, e.g. Tuning = Drop C. Drag songs into the set. Songs already in the set get a small dot. Version count shows as a badge.
- **Deleting a song from the Library:** confirm, and list the setlists that use it.

## 4. File menu (new shape)

- New setlist
- Duplicate setlist
- Export setlist…
- Import…
- Library ▸
  - (list of Libraries)
  - New library…
  - Rename…
  - Show in Explorer/Finder
- Backups ▸
- Clean up unused audio…
- Settings…
- Copy diagnostics
- Quit

**Removed:** Open, Open Recent, Save, Save As, and "Copy into session". Audio is always copied into the Library on import.

## 5. Export / Import

This replaces Save As, and is how material moves to the Mac, a backup rig or a bandmate.

- **Export setlist…:**
  - Writes one `.setline` package (a zip).
  - It holds the setlist, every song it uses (all versions), only the audio those songs need, the song field definitions and values, the dashboards, and the patch name lists.
  - Show progress, and make it cancellable.
- **Import… (a `.setline` file):**
  - Merges into the current Library.
  - Match songs by internal ID first, then by audio content hash.
  - If a matching song differs, ask once per import: "Keep mine / Use imported / Keep both". Keep both creates "<name> (imported)".
  - Audio that's already present isn't copied again.
  - The setlist is added. If its name already exists, add " 2".
- **Cross-platform:** export on Windows, import on Mac and vice versa. This covers the earlier pending cross-platform show test.

## 6. Multiple Libraries (light)

- File → Library ▸ switches between Libraries. Each Library is completely separate.
- Switching is refused while playing.
- Most users will have one. Don't build anything else for this.

## 7. Migration from Shows

- **On first launch after this phase,** find existing shows in `Documents/set.Line/Shows`, the recent list, and the old default locations.
- Offer **"Bring your shows into the Library"** with a list and checkboxes, all ticked. Then:
  - each show becomes a setlist
  - songs merge by audio content hash + name
  - per-show settings go to the setlist or Library according to the table in section 1
- **Never** modify or delete the original show folders. Write a migration log, and tell the user they can delete the old folders themselves.
- **Test:** migrate two shows that share a song. The result is one song and two setlists, and the audio plays identically.

## 8. Settings and Perform touch-ups

- **Settings → General:** On launch; Library location (read-only, with "Show in folder").
- **Perform:** the setlist name and the setlist picker sit at the top. Switching setlists is refused while playing.

## Done when

- Old shows migrate correctly.
- An export on Windows imports on Mac (CI can do a headless round-trip test with the core model if possible).
- There is no Save anywhere, and nothing is lost after a force-quit: the last change before the kill is on disk.
