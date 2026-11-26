# Phase 9a · Time signatures, tempo cleanup, Ableton import

Priority: **time signatures are #1** in this batch. Do 9a first.
Mockups: `docs/design/phase9/d2-zoom.png` (time signature popover), `d4-import.png` (import window).
The show machine is still the 2015 Intel MacBook on macOS 12, 1280×800. Everything must work and fit there.

## 1. Time signatures (new)
A time signature is a change on the tempo map, just like a tempo change. It applies from a bar until the next change.

- **Model:** `TempoMap` gets meter events `{bar, numerator, denominator, grouping}`. The default is 4/4 at bar 1. Allowed numerators are 1–32 and denominators 1, 2, 4, 8, 16, 32. Every bar/beat ↔ time conversion in the core must go through the meter map (no hard-coded 4 beats per bar anywhere: search for it).
- **Grouping** sets the click accents for odd meters, e.g. 7/8 as 2+2+3 / 3+2+2 / 2+3+2 / every 8th. Defaults: 5/8 = 3+2, 7/8 = 2+2+3, 9/8 = 3+3+3, 12/8 = 3+3+3+3; for x/4, the accent is on beat 1.
- **The beat unit follows the denominator.** In x/8 the click ticks 8ths and accents the group starts.
- **Everything follows the meter map:** the generated click (normal and Drum click), bar numbers and the ruler, the bar.beat.sixteenth display, cues ("One, Two, Three…" counting a 7/8 bar counts to 7, or by groups if the cue words say so), quantised jumps and loops (bar boundaries), sections, MIDI clock and Song Position Pointer (SPP counts 16ths, so it stays correct across meter changes), band screens, the "Until next change" widget and the Perform view.
- **UI:**
  - The meter shows on the ruler as a small cyan badge at each change (e.g. "7/8").
  - Right-click the ruler → "Add time signature…". Click a badge to edit it in the popover (numerator/denominator steppers, grouping chips, a preview of the accents, delete).
  - The song header chip reads "4/4 → 7/8 at 89" when a song has changes.
  - The section panel shows the meter at the section start.
- **Count-in** follows the meter at the start point.
- **Tests:** core tests for bar↔time across mixed meters (4/4 → 7/8 → 6/8 → 4/4, with tempo changes in between), click positions and accents, SPP values after a 7/8 bar, and quantised jumps into a 7/8 bar. A UI test checks that a 7/8 badge renders.

## 2. Tempo display and cleanup
- **Store tempos exactly; display rounded** to at most 2 decimals with trailing zeros dropped (124, 161.38, 122.5). This applies everywhere a BPM is shown: song headers, the library, the setlist, the transport, band screens, exports and the print setlist.
- **On import (Ableton, and any future importer):** a tempo within 0.0005 BPM of a value with ≤3 decimals snaps to it (123.99999999999623 → 124, 179.9884490000081 → 179.99, *not* 180). Never snap a real tempo; this only removes float noise. Note the snapping in the import report.
- **The editing fields** accept up to 3 decimals.

## 3. No tempo leaking into the end of a song
From the real project: some songs end with a tempo change that belongs to the next song, because Live's tempo automation steps a little before the next locator.
- **On import:** a tempo or meter change that falls within the **last bar** of a song, at or before the next song's start, belongs to the next song. Move it to bar 1 of that song, so the current song keeps its own tempo to its end.
- **Same for meters.**
- **Re-test on the real project:** no song's last bar should show the next song's tempo (check END OF HEARTACHE, GARDEN, HAND OF FATE, NIHILOPHOBIA, PROXIMA, PROXIMA 2 and THE RUNAWAY, which all had odd tempos in the screenshot).

## 4. Ableton import: Live's time signatures
Read Live's time signature changes (the master track's time signature automation / `TimeSignature` events). Bring them in as meter events per song, using the same last-bar ownership rule as section 3. Update the existing `.als` tests with a fixture that has a 4/4 → 7/8 → 4/4 project.

## 5. Ableton import: sort markers (new step 1)
The real project produced extra "songs" from utility locators: 5–6 called **TERM**, plus guitar change markers. Add a first step to the import window: **Sort markers** (see `d4-import.png`).
- **Every Live locator gets a guess:** **Song · Section · Marker · Break · Ignore**. The user can change any of them from a dropdown.
- **The guesses, in order:**
  1. A name that repeats 3+ times across the set (e.g. TERM) → **Ignore** ("repeats 6× across the set").
  2. An unnamed locator → **Ignore** ("marks the end of SENECA"). It still ends the song, as now.
  3. A name containing GTR, GUITAR, CHANGE, TUNE, TUNING, SWAP, BREAK, TALK or INTERMISSION that sits **between** songs with no audio under it → **Break** with the matching label (Gear change / Tuning / Talk / Intermission; see 9d).
  4. A locator inside a song's audio that isn't a section → **Marker**. Markers become visible markers on that song's ruler, not songs.
  5. Otherwise, a locator that starts a block of audio → **Song**.
  6. SECTION-track clips stay **Section**, as today.
- The table is grouped into Songs / Utility / Sections, with the reason in grey.
- The choices are remembered per project file, so a re-import offers the same ones.
- **Breaks created here** go into the imported setlist between their songs (9d's Break item). If 9d isn't built yet when 9a ships, store them and create the Break items once 9d lands. Note which way you went.

## 6. Ableton import: one window, start to finish
Today the screen "goes wild with windows popping in and out" during import. Fix it:
- **One modal window** with steps **1 Sort markers → 2 Options → 3 Import**. Options is the current preview's options (click / cues / sections from cues / name tracks after files…).
- **Step 3 shows a single progress list:** an overall bar (files and GB, plus an estimated time left), then one row per file with its own bar, ✓ when done, and "… N more".
- **Nothing else opens, re-lays out or flashes** behind the window until the import finishes. Songs are added to the library in one batch at the end (or in batches the UI doesn't re-render per file). The library view must not rebuild per file.
- **Run in background:** the window shrinks to a small progress pill in the top bar, the app stays usable, and clicking the pill reopens the window. Never import while playing; if the user presses Play, keep copying files but hold the library update until Stop.
- **Cancel** cleans up the files copied so far.
- **Tip line:** "Copy the project to this computer's drive first. USB drives are the slow part." Show it when the source is on a removable volume.

## Re-test on the real project
`D:\2025-2026\EIA 2026-2027 Project\EIA 2026-2027.als` imports into a **TEST library only** ("EIA 9a Test"). The drive and the project are read-only; never touch the main library. Report:
- the marker sort results: how many were Ignored, made into Breaks, made into Markers, and how many Songs
- the meters found
- every tempo that was snapped (from → to)
- the songs whose end-of-song tempo was moved to the next song
- the import time, with the single window confirmed (no flashing)
