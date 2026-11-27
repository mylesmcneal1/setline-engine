# Edit anything, and the 0.1.63 polish pass (phase 11)

The spec is `docs/phase11-polish.md`; the user's screenshots are in `docs/design/phase11/`. The code is
`ui/public/fix11.js` / `fix11.css`, with changes in `menus9.js` (the object menus), `secs10.js` (suggested
sections), `click10.js` (the editor), `fix10a.js` (rename in place), `time9e.js` (the scrollbar strip) and the page.
Tests: `tests/ui-11.js` (Chrome and macOS WebKit in CI).

## Every object, the same four places
Right-click, ⋯ (where the object has a row), the menu bar and ⌘K offer the same items, all with Undo:

| Object | Rename | Edit | Delete | Asks first when… |
|---|---|---|---|---|
| Song | ✓ | ✓ | ✓ | (as before: it's in setlists) |
| Version (Album too, while another stays) | ✓ | Show / Make main / Duplicate | ✓ | a setlist plays it |
| Section | ✓ | ✓ | ✓ | – |
| Track: audio, Click, Drum click, Cues, MIDI | ✓ | ✓ | ✓ | (audio recorded in set.Line, as before) |
| Marker | ✓ | Go to it | ✓ | – |
| Tempo change | – | ✓ | ✓ (not bar 1) | – |
| Time signature change | – | ✓ | ✓ (not bar 1) | – |
| Setlist | ✓ | Open / Duplicate | ✓ (the last one too) | – |
| Break | label | ✓ | ✓ | – |
| Library | the open one | Open | any other one (to the Trash) | always (Undo can't bring a folder back) |
| Preset | ✓ | – | ✓ | songs use it |
| Recorded cue word | ✓ | Preview | ✓ | cues say it |
| Modeler scene name | ✓ | – | Clear the name | – |

- **The menu bar:** Edit › Rename… / Edit… / Delete act on what was clicked last (a marker, a tempo point, a version
  row…); a click on a song, a track or a section hands them back to those. Song › Edit version › / Markers › / Tempo
  changes › / Time signatures › list the song's own; Library › Delete library ›.
- **⌘K:** type an object's name with what to do: "delete click" → Delete track “Click”, "rename verse" → Rename
  section “Verse 1”, "delete 7/8" → Delete time signature “7/8 at bar 25”.
- **Undo** now also covers presets, recorded cue words and modeler scene names (they were outside the undo history).

## Click and cue tracks
They're tracks: rename (the clip goes along; "Click" keeps its clip in `s.ck`, any other name in `s.cks[name]` with
its role in `s.troles`), duplicate (a click track's copy takes its clip), delete (with its clip; Undo restores both).
A song with no click track shows "＋ Add click track" in yellow under its tracks. A track can't be renamed to a click
or cue track's name ("Click", "Cues") unless it is one. A song keeps one cue track (no copy).

## Setlist rows
No ‹ › arrows: the version line ("Album ▾ · 4:24") is the switcher, the dots stay, ⌥[ / ⌥] still flip. The ⋯ button
has its own 30 px at the right edge; the row's × (hidden while hovering since 10b) is gone (⋯ › Remove from…, ⌫). No
coloured outline around songs with versions; the playing song's number turns green with ▶.

## Rename in place
The field takes the name's own box (left, top, width, height within 2 px), font, weight, colour and padding; the name
under it hides; it grows to the right as you type, up to its row's edge. ↩ or clicking away saves, Esc cancels. Used
for setlist rows, cards, Folders rows, the song title, track headers, sections, versions, markers, cue words on the
lane, the setlist name and the library name (the breadcrumb).

## Sections
- **Why they stacked:** 10b's hover ⋯ gave section blocks `.ix10 { position: relative }`, which came after the page's
  `.sec { position: absolute }`, so each block became an inline box and they wrapped onto a second line over the
  Click track. Section blocks are absolute again, and the row clips anything that would leave it.
- **Never overlapping:** sections from cues, an Ableton import, a section added, split, moved or resized: each ends
  where the next starts (two on the same bar: the later one goes). A cue in the second half of its bar (a pickup, "Verse"
  said a beat or two early) starts its section on the next bar line.
- **Repair once:** when the library opens, songs (and own-timeline versions) with overlapping sections are
  straightened in one undo step ("Straightened 3 sections in GARDEN · Undo"). Each song is looked at once per computer,
  so an Undo stays undone.
- **Suggested sections:** dashed, in their section colours, "Suggested" on the first; the buttons are in a slim bar
  above the row ("9 sections suggested from your cues · Use them · Edit… · Dismiss"). Dismiss hides it for that song;
  Sections › From cues brings it back.

## The click editor zoomed out
It shares the timeline's zoom and position (as it did); its header says "Bars 1–57 on screen (of 105)". Bar numbers
thin out (every bar, 2, 4, 8, 16…) so they never touch; time signatures have their own thin row. Notes are blocks
when there's room, thin ticks under about 4 px, and a density strip when there's more than about one note per two
pixels. Velocity is a bar per note zoomed in, else the average per pixel column as a line (accents and clicks).

## The rest
- Count-ins on the Cues lane: when "One Two Three Four" would overlap they're one "1-2-3-4" label; labels never run
  into the next one.
- Track names: a leading "GARDEN / " or "GARDEN - " is dropped on import and once for existing songs (with Undo); the
  full name is in the track's tooltip.
- Waveforms are scaled to fit their lane per clip (display only), with "×N" when boosted more than 4×.
- The output picker stays "Out 1" when the header is narrow (the name gives way first; the full output in its tooltip).
- The sideways scrollbar has a 10 px strip of its own under the lanes.
- The line between the timeline and the click editor has a visible handle; its height is remembered.
- M / S: a filled colour when on, an outline when off, without hovering.
- The hover trash button on track headers (it sat under ⋯) is gone: ⋯ › Delete track, or ⌫.

## Overlap check
`tests/ui-11.js` focuses each row (and copies every `:hover` rule onto a test class, so what shows on hover is
checked too) and fails when two controls in a row overlap by more than 1.5 px: setlist songs and breaks, cards,
Folders rows, track headers, sections, version rows, the Sections and ruler headers, the click editor's header, the
suggested-sections bar, the setlist name. At 1280×800, in all 15 font pairings, in Chrome and WebKit.
