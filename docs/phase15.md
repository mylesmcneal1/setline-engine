# Phase 15 — Remote screens, phone layouts, track editors, click accents, fixes

Mockups: `docs/design/phase15/` (file names below). User screenshots of bugs are in the same folder (`bug-*.png`).
`docs/daw-conventions.md` still governs every interaction (Ableton first, Logic second). The show Mac (2015 MBP, macOS 12.7, WebKit, 1280×800) must keep working. Satellites/remotes never get level, gain or mute controls.

---

## 1. Cue readout speed — `cs.png`
- Cues › Speed… : slider 0.75×–1.5× (default 1.0×), mode **Fixed** or **Follow tempo** (scales with song BPM relative to 120, clamped to the slider range).
- Applies to Kokoro natural voices only (recordings play as recorded). Global setting, saved with the library.
- On change: regenerate cue audio in the background (never on Play — keep the Phase 14 fix), show progress in the status area; old audio is used until the new audio is ready.

## 2. Single-click a track header opens its editor — `te1.png`, `te1-zoom.png`
- Single click on a track header opens that track's editor in the bottom editor area. Click another header to switch; click the open one again or Esc to close. Double-click on the name still renames.
- Click track → click editor. MIDI/modeler track → patch change editor. Audio track → **new audio track editor**:
  - its clip(s) large, with a clip gain line and fade-in/fade-out handles (drag); values shown and editable (type a number, drag, double-click to reset to 0 dB / no fade)
  - volume, small M and S buttons (small — as in te1-zoom), meter, output, colour, link-zoom toggle, play/stop/restart group
- Uses the same bottom-editor shell, independent zoom and link toggle as the existing editors. All edits undoable.

## 3. Remote screen editor: WYSIWYG — `bug` screenshot from earlier
- Widgets in the editor must render exactly like on the device, with live data when a song is loaded and realistic sample data otherwise. Never blank boxes.
- Fix: "Previou…" truncation, unlabelled ● toolbar button (label it or tooltip + clear icon), multiple blue outlines when only one widget is selected, the widget list must be visible/reachable.

## 4. Remote editor grid — `rg.png`
- Per-screen grid settings: columns × rows (adjustable), gap, snap on/off (⌘/Ctrl while dragging ignores snap), alignment guides while dragging.
- Align / distribute buttons for multi-selection; editable x / y / w / h fields in the inspector.

## 5. Per-widget style — `rg2.png`, `rg3.png`
- Background: Solid / Transparent / custom colour (use the existing colour wheel), opacity, border on/off, text shadow (useful when transparent).
- Align content: 3×3 picker (default centre).
- Applies to every selected widget at once. Saved per widget per screen.

## 6. Remote screens move smoothly
- Server sends timestamped position messages (song position, tempo, play state, server time). The device keeps its own clock (estimate offset via ping), interpolates at 60 fps with requestAnimationFrame and corrects gently (no visible jumps unless the error is large or a locate happened).
- Only redraw what changed; no layout thrash. Throttle non-timing data.
- Test on iPhone Safari (WebKit) with simulated network delay/jitter. Not a Mac performance problem — don't treat it as one.

## 7. Phone layouts — `ph.png`, `ph2.png` (ph2 = the user's real iPhone screen, redesigned)
- Each remote screen has a device choice: iPhone, iPhone large, iPhone SE, iPad, iPad mini, laptop, custom; portrait/landscape. The editor shows a true canvas for that device with safe areas.
- "Copy layout from…" another screen.
- A phone opening a screen that only has an iPad/laptop layout gets an automatic stacked phone layout (widgets in reading order, full width, sensible heights) — never the big layout shrunk.
- Problems from the user's iPhone that must be gone: widgets off the right edge, the "computer outputs" chip on top of the clock (status messages get their own line at the top, never over widgets), clock truncated ("10:40:36 …"), tiny Play button with huge text, tall thin Sync MIDI. Text auto-fits each box; clock widget can show h:mm.
- Full-screen web app: Add to Home Screen opens with no Safari UI (`apple-mobile-web-app-capable`, manifest `display: standalone`), Screen Wake Lock while connected (with fallback), no pinch-zoom / double-tap zoom / scroll bounce, dark launch background (no white flash), safe-area insets respected.
- **Home screen icon = the set.Line app icon** (same artwork as the Mac/Windows app): apple-touch-icon 180, manifest icons 192/512 (+ maskable), favicon; name/short_name "set.Line". If the icon only exists in the app bundle, export these sizes from the same source artwork.

## 8. Import review: locator type dropdowns do nothing — `bug-import-dropdown.png`
- Every Song / Section / Gear change / Ignore dropdown opens, the choice sticks, the hint text on the right updates, and the import uses it.
- Keyboard works; Shift-click / multi-select rows to set many at once (ties in with item 9).
- Test in WebKit — likely a WKWebView `<select>`/custom-dropdown event issue.

## 9. Select All / Deselect All everywhere
- Select All is already listed in Key Commands (⌘A / Ctrl+A) but doesn't work everywhere and isn't usable. Wire it up and put Select All and Deselect All (⇧⌘A / Ctrl+Shift+A, and Esc) in the Edit menu.
- Context-aware: song view → all clips on all tracks; click/MIDI editor → all notes; patch editor → all patch changes; audio track editor → its clips; setlist sidebar → all songs; import review → all rows; remote editor → all widgets. In a text field → the text only.
- Delete, copy, move and nudge work on the whole selection. Greyed out when nothing can be selected.

## 10. Restart and play in Folders view — `f4-folders-restart.png`
- The playing song's row shows the same compact play/stop/restart group as the song header (⟲ restart, ■ stop, current bar). Hovering any other row shows ⟲ restart (cue from bar 1) and ▶ play.
- Same commands in the row's ⋯ menu and right-click; ⌥Space restarts the selected song.
- Audit Folders view against Cards view and give it anything else that's missing.

## 11. Key Commands window layout — `bug-key-commands.png`
- Playback rows are broken: the name column collapses so names wrap one word per line and rows overlap; Editing rows put the keys far to the right.
- One grid for every section: Command (menu name small underneath) | Mac | Windows | reset. Fixed commands use the same grid, dimmed, with a lock icon instead of reset.
- Names on one line (ellipsis), compact rows, sticky column headers and section titles. Check at 1280×800 on macOS 12 and in a small window.

## 12. Click accents — `ac.png` (approved: "a far better ui and menu")
- New **Accents** button in the click editor header (also on right-click of a selection) with: First beat of the bar only (current behaviour) / Every beat / Every half bar / Custom pattern.
- Every beat = ONE e & a TWO e & a: three levels — downbeat accent, beat, subdivision — with adjustable Accent / Beat / Subdivision levels (velocity).
- Custom: one bar of steps at the current fill (¼, ⅛, 1/16, triplets), tap to cycle Accent → Click → Off; works for odd meters and patterns like 3+3+2.
- Apply to selection or whole song. Result is ordinary notes on the Accent and Click lanes (velocities), fully editable by hand; undoable. Re-applying after changing the fill keeps the chosen accent mode.

## 13. (Suggestion) Updater ready for the private repo — repo goes private Sun 29 Nov
- File › Check for updates… must keep working once the repo is private: if the releases API returns 404/401, ask once for a GitHub token (fine-grained, read-only Contents on this repo), store it in macOS Keychain / Windows Credential Manager, never in the library or logs. Use it for API and asset downloads (Accept: application/octet-stream). Clear message + "Change token…" when it's invalid.
- Don't change the repo's visibility yourself.

---

## Testing
- Extend the WebKit CI suites for every item; add a phone-sized WebKit run (390×844 and 375×667) for remote screens, including the auto-stacked layout and the manifest/icon tags.
- Simulated network jitter test for item 6 (no position jumps > 1 frame when the error is small).
- Keep everything passing on Windows and macOS-15 CI; the universal binary still targets 10.15.
- End with a short report: what changed per item, anything not done and why, and the release version.
