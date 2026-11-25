# Phase 6e: Setlist flow and song versions

Do this after `docs/phase6d-streamline.md`. It builds on that layout: Show | Perform | Band, the console-strip track headers, and the right panel showing the selected item.

Mockups are in `docs/design/versions/`:
- `versions.html` (call `setV(0|1|2)` or `perf(true)` in the browser console to see each state)
- `v1`–`v4` PNGs
- `v5-walkthrough.mp4`

**The user's rule:** live first. Changes made mid-show must be instant, glitch-free and obvious. Settings that rarely change stay out of the way.

**Still true from earlier phases. Do not break any of these:**
- no resampling of stems
- disk-thread clip compositing
- RT-safe audio thread
- atomic saves
- old shows must still open

---

## 1. Song versions

Interludes are NOT a separate feature. The user builds an interlude into a version of the song, e.g. "Glasshouse – With intro".

### Model

- A song has one **source arrangement**: its stems/clips, tempo map, sections, cues and MIDI. This is the full timeline you see in "Album".
- A **version** has:
  - a name
  - an ordered list of section references from the source (sections can be skipped or reordered)
  - optional **version-only audio**: clips/tracks that only this version plays, e.g. an intro pad (shown with ◆)
  - a "default in new sets" flag (one per song)
- Every version uses the same stem files. Nothing is copied.
- Each setlist entry stores which version it plays, so the same song can play different versions in different sets.

### Playback

- The playing timeline is the version's sections laid end to end.
- Build it on the disk thread from source time ranges, the same way clips are composited now.
- The tempo map, cues, MIDI events and section markers follow their sections.
- **Joins:**
  - Where two sections are contiguous in the source, there must be no join at all; play straight through.
  - Where they aren't contiguous (a skipped or reordered section), apply a very short equal-power crossfade at the join (default 5 ms) so it doesn't click.
  - No resampling and no time-stretching.
- Version-only audio is placed in the version's timeline, not the source.

### Migration

First check how versions are stored today (the "Versions" card in the Song panel, e.g. Album / Festival cut).
- Map existing versions onto the new model where it fits.
- If a version can't be expressed as sections of the source, keep it as a standalone "custom" version. It plays exactly as before. Disable section editing for it, with a one-line explanation in the panel.
- Add a test: an old show opens, plays the same audio, saves and reopens.

### UI (mockups v1–v3)

- **Setlist:**
  - A song with 2+ versions shows as a stack of cards: the front card plus two offset cards behind it.
  - The front card has the name, current version name with ◆ if it has version-only audio, length, ‹ › arrows and position dots.
  - ‹ ›, or the scroll wheel over the card, flips versions. Add a short slide animation.
  - The set's total time updates.
  - Songs with only one version look like normal rows.
- **Song view:**
  - A "Versions" strip panel sits above the timeline.
  - Each version gets one row: name, a section-colour strip scaled to bars on a shared scale (so lengths can be compared), and its duration.
  - The selected version has a highlighted row. Click a row to switch.
  - "＋ Version" copies the current version and selects the copy, named "<name> copy", which you can rename at once.
- **Right panel** when a version is selected and no track is selected:
  - "Sections in this version": every source section, plus version-only items. Each has a checkbox (untick drops it, shown with strikethrough) and a drag handle to reorder.
  - "Version" card: name, "default in new sets", "Add audio just for this version" (drop files or pick), and Delete version… (can't delete the last one).
  - The Song info (key, tempo map) stays reachable. Put it in a "Song" card under them, collapsed.

### Perform (mockup v4)

- The "Up next" card is a stack too, with big ‹ › buttons, the version name, ◆, length, "N of M" and a mini section strip.
- Changing the version pre-loads it in the background. Show "Loading…", then "Loaded and ready". It must never glitch the song that's playing.
- The playing song's version can't be changed. Only songs not yet playing can.
- Band screens should show the version name next to the song (just the data now; the screens come later).

## 2. Transitions between songs

Check what's already built (the mockup's setlist shows "↘ Segue" and "Auto-next after 4 s") and finish or fix it to match this.

- **Each setlist entry has an "After this song" setting:**
  - **Stop** (the default): stop at the end and select the next song, ready for Play.
  - **Segue**: the next song starts on the exact sample after this one ends, with no gap. Pre-load it well before the end. This is what makes album-style interlude versions work.
  - **Auto-next after N s**: stop, wait N seconds, then start the next song.
- **Where you set it:**
  - right-click on the song in the setlist → "After this song ▸"
  - the right panel when the song is selected
- **How it shows:** the small label under the song in the setlist (↘ Segue, ⏵ Auto-next 4 s; nothing for Stop).
- **Prev/Next:**
  - While playing, Next stops the current song and starts the next one from its start. Prev does the same with the previous song. Use a quick fade (about 10 ms) so it doesn't click.
  - While stopped, Prev/Next just move the selection.
- **Queued jumps:**
  - Clicking a section on the Perform screen while playing queues a jump. Esc or clicking it again cancels.
  - The queued section blinks.
  - "Jump timing" control on the Perform screen: Next bar (default), End of section, or Now.
- **Loops:**
  - A section can be marked Loop in its section panel. It repeats until "Exit loop" (button, key L).
  - Exiting leaves at the end of the current pass.
  - The Perform screen shows LOOPING clearly.
- **Count-ins stay inside the songs' tracks.** No separate count-in feature.
- **Keyboard actions, for future footswitch mapping:** Play/Stop, Next song, Previous song, Next version of next song, Exit loop, Cancel queued jump. Put them all in one action list so MIDI-learn can map them later.

## 3. Tests (core, without JUCE where possible)

- A version render with skipped/reordered sections:
  - exact expected length
  - joins land on the right samples
  - no click at joins (a crossfade is present)
  - contiguous sections are untouched
- A segue rendered offline between two songs: no gap and no overlap; the first sample of B immediately follows the last sample of A.
- A queued jump lands exactly on the next bar line.
- Loop exit happens at the end of the pass.
- Version migration of an old show.

## Done when

- Both phases are built. CI is green on Windows and Mac, and all tests pass.
- Commit and push.
- The report has:
  - one manual test list for 6d + 6e (numbered, at most 20 items)
  - everything removed
  - any decision that differs from either spec, and why
