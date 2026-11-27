# Phase 14 · Fixes from testing 0.1.71

**Read `docs/daw-conventions.md` first.** Show machine: the band's 2015 MacBook, macOS 12 (WebKit), 1280×800. Mockups in `docs/design/phase14/`. Test UI behaviour in the WebKit CI job.

## 1. Break editing: one popup (mockup `bk2.png`)
Today:
- Setlist › Edit break… does nothing
- double-clicking a break row does nothing
- adding a custom break only lets you type a name

**Replace all of it with one popup** anchored next to the setlist row, used by **+ Break**, **double-clicking a break**, **Setlist › Edit break…**, the break's right-click › Edit…, and ⌘K:
- **Name:** text field (focused, text selected) plus quick-label chips (Gear change, Tuning, Talk, Intermission) that fill it.
- **Length:** a time field accepting m:ss or seconds (e.g. "1:15", "75"), ▲▼ in 5 s steps (⇧ for 30 s), and preset chips 0:30 · 0:45 · 1:15 · 2:00 · 5:00.
- **Note for the band** (optional).
- **When the time runs out:** Wait for Play / Start next song.
- **The header** says "New break · after <song>" or "Edit break".
- **↩ saves; Esc cancels.** Undo works. On a new break, Cancel adds nothing.
- **The remote screens, Perform and printing** pick up the changes.

**Test** every entry point in WebKit.

## 2. Sync MIDI uses the first song in the setlist (mockup `sy.png`)
**The sync point is no longer set up separately.** Sync MIDI sends what the **first song of the current setlist** needs at bar 1:
- each MIDI / modeler track's preset (bank + PC) and scene / CC state
- any other program changes or CCs in effect at bar 1
- MIDI clock: tempo plus Song Position Pointer at bar 1

**The behaviour:**
- **One press sends immediately,** with no confirm. **Hovering** (or a long-press on touch) shows a preview listing each device and what it'll get (mockup).
- **⌥-click** syncs to the **selected** song instead.
- **It updates itself** when the setlist is reordered or the first song's MIDI changes.
- **Remove the old per-device sync point settings,** migrating anything not covered by the first song's bar-1 MIDI into a one-time note.
- **The remote screen Sync MIDI button** and the 7c footswitch "Sync MIDI" do the same.

**Test:** the messages generated for QC, Axe-Fx and generic devices match the first song's bar-1 state, and reordering changes them.

## 3. Play is delayed 2+ seconds after editing cues
After editing cues, pressing Play sometimes takes **2 seconds or more** before anything plays.
- **Find the cause:** time every step between Play and the first audio on the Mac build (likely regenerating natural-voice cue words, rebuilding the whole song's cue audio, a synchronous save or reload, or a lost pre-load). Report it.
- **The fix:**
  - **Cue words are generated once per (word, voice) and cached on disk;** moving or copying a cue never regenerates. New or renamed words generate in the background when they're created, never at Play.
  - **Edits update only what changed.** The pre-loaded audio from 8d is updated in place, not thrown away (cues, clips, click, MIDI).
  - **Play never waits on cue work, saving or generation.** Audio and click start immediately, and a cue that isn't ready joins when it's ready (or is skipped once, logged in Diagnostics).
- **Measure on the Mac build:** Play latency right after editing cues, clips, the click and MIDI. The target matches a normal Play (8d numbers). Report before / after.

## 4. "Add click track" does nothing
Fix it in every entry point (Track › Add click track, the empty-song suggestion "+ Add click track", ⌘K). **Then add a test that runs every "Add…" command** (audio track, click track, MIDI track, section, tempo change, time signature, marker, break, song, setlist, version) from the menu bar, ⌘K and its other entry points, and asserts the item was added and selected.

## 5. First, carried over from the Phase 13 report
Several older local test scripts broke when the example songs were removed. **Rewrite the useful ones as CI suites** using `tests/fixtures/demo13.js` (or a minimal fixture), especially:
- **pedal / footswitch playback** (7c / 7d / 8d)
- **"only one song open at a time"** (9b)

Confirm neither has regressed. Delete scripts that are fully covered elsewhere.

## Report
- the manual test list (max 15, mark [MAC])
- the cause of the Play delay, and the before / after numbers
- the result of the pedal and one-song-open checks
- any decisions that differ from this spec
