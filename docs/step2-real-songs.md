# set.Line — Step 2: real songs

Read this whole file and docs/step1-app-shell.md (still applies: real-time rules, "Don't" list, phase-by-phase with a report and commit after each). Start only after step 1 is merged and CI is green.

## Goal
Real stems in, real waveforms on screen, and every audio edit in the Edit page (clips, splits, moves, gain, fades, mutes) heard through the interface exactly as drawn, together with the click, spoken cues and MIDI. After step 2 the user can build and play a real song with set.Line alone.

## 1. Importing stems
- The New Song sheet and "+ Track" use a native file picker through the bridge (pickAudioFiles() → paths plus channels, sample rate, length, format read with JUCE). Dropping files onto the window should work too. Use native drag-and-drop if the WebView doesn't hand real file paths to the page.
- Sample rate must match the session's rate. If it doesn't, refuse that file and say why ("this file is 44.1 kHz, the show runs at 48 kHz; export it at 48 kHz"). Never resample.
- Mono and stereo only. Anything else gets a clear refusal.
- Session folder: a .setline session lives in its own folder with an Audio/ subfolder. Imported files are copied there by default (a "Copy into session" option, on by default), and the session stores relative paths, so a show folder can move between computers and between Windows and Mac. Show a progress bar while copying large files.
- Missing files: on open, list any missing audio and offer "Locate…" (one found file can fix the rest in the same folder). Missing stems play as silence with a warning; they never block the rest of the show.

## 2. Waveforms
- Peaks are computed natively on a background thread when a file is imported (and on first open if missing), saved next to the audio as a small cache file, and sent to the page in a compact binary or base64 form at a few zoom levels.
- The Edit page draws real peaks with the existing single-shape waveform style (one solid shape per clip in the track's lightened colour). Gain, fades and mute still shape what's drawn. The simulated waveforms remain only for the browser fallback.
- Opening a session with many stems must not freeze the interface: load peaks lazily, showing what's on screen first.

## 3. Audio clips in the engine
The Edit page already models clips (s.clips[track]: {start, end, off, gain, fi, fo, mute} in seconds). The engine must play them exactly:
- Replace "one file from time 0" with per-track clip playback. Recommended: the disk thread renders each track's timeline into its ring buffer by compositing that track's clips (source offset, clip gain, fade-in/out curves, clip mute, silence between clips). The audio thread keeps doing a plain ring read and the live track level/mute/solo ramp from step 1. Seeking and looping re-prime from the new position as today.
- Fades use the same curve the page draws. Clip boundaries are sample-exact (seconds × rate, one rounding rule, as with the tempo map).
- Clip edits while stopped apply immediately. While playing, they apply at the next play/jump, as in step 1.
- Self-test additions (with in-memory sources):
  - a clip starting mid-file at a non-zero offset lands on the exact sample
  - a split clip plays back identically to the unsplit clip
  - fade-in and fade-out sample values match the curve
  - a gap between clips is digital silence
  - a muted clip is silent
  - jumping into the middle of a clip is sample-exact
  - looping across a clip boundary is sample-exact on every pass

## 4. Spoken cues
- Cues (s.cues: {bar, text}) are spoken with the operating system's voices, chosen per session and overridable per song: Windows speech (SAPI or Windows.Media.SpeechSynthesis) and macOS AVSpeechSynthesizer. List the installed voices in the settings, with a Preview button.
- Render each cue to audio ahead of time (on edit, cached by text + voice + rate). Never synthesize during playback. Resample the rendered speech once at render time to the session rate. That's the one allowed exception, since it's generated material, not a user stem.
- The engine plays cues as preloaded one-shot samples starting exactly at the cue's bar, on the Cues track's output, under its live level/mute. Add a self-test check that a cue starts on its bar's sample.

## 5. Everything together
- Click (explicit hits), MIDI, audio clips and cues all derive from the same tempo map and rounding rule. Add one combined self-test song with all four, and check alignment at several block sizes, from a jump, and across a loop.
- Song versions: play the selected version's clips, mutes, gains, click, cues and MIDI.
- Save/open round-trips everything (clips, cue voice settings, file references).

## Phases (report + commit after each)
1. Session folder, native file picker/drop, rate check, copy into session, relative paths, missing-file handling.
2. Peaks: native computation, cache, transfer, real waveforms drawn on the Edit page.
3. Engine clip playback + all self-test checks in §3.
4. Spoken cues: voices, pre-render cache, engine one-shots, self-test.
5. Combined alignment test (§5), versions, save/open round-trip.
6. CI green on Windows and macOS. Then a manual test with real multitrack stems from this PC (the Downloads folder has several stem folders). Build a song, add sections, a click clip, cues and a split/faded clip, and play it through the iD14 on ASIO.

## Done when
- A real multitrack imports in one go, shows real waveforms, and plays through the interface on the routed outputs with the click, cues and MIDI in time.
- Splitting, moving, trimming, fading and muting clips sounds exactly like what's drawn.
- The session folder can be copied to the Mac and opens there with nothing missing.
- All self-tests and CI pass on both platforms.
