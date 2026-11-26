# Phase 8d: Live-safety extras

1. **In-app updates.** Under the menu → "Check for updates…" (and a quiet check on launch, at most once a day):
   - compares the running version with the "latest" release
   - shows the release notes
   - downloads, verifies the SHA-256 and installs like `setline-update` does (keeping the previous build for rollback), then relaunches
   - **never while playing**; it waits until stopped
   - the band's Mac must never need Terminal again
   - "Roll back to previous version" lives in the same place

2. **Crash recovery.**
   - If set.Line quits unexpectedly while playing, it saves (continuously, cheaply) the setlist, song, version and position.
   - On the next launch it shows **"set.Line closed unexpectedly. Resume Glasshouse at bar 41?"**, with Resume (loads, positions, and plays on Play) and Dismiss.
   - It also offers "Sync MIDI" right there.
   - Test: kill during playback → relaunch → the prompt shows the correct position.

3. **Printable setlist (PDF).** In the setlist menu → "Print setlist…": big, high-contrast text for the stage floor.
   - **Per song:** number, name, version, key, BPM, length, and chosen song/preset fields (e.g. Tuning), plus transition markers (↘ segue).
   - **Options:** font size (L / XL), columns 1–2, include fields.
   - It exports a PDF, so there's nothing to install.

4. **Faster pedals.** Footswitch / controller messages mapped to transport actions (Play/Stop, Next, Prev, Jump, Vamp, Exit loop, Sync MIDI) take a **native fast path** straight to the engine, without going through the web page. The page is updated afterwards.
   - **Target:** under 5 ms from MIDI in to the action, even while the UI is busy.
   - Keep keyboard shortcuts on the existing path.
   - Measure and report the worst case.

## Done when
- Tests pass and CI is green on Windows and Mac. macOS 12 Intel is still supported.
- Commit and push.
