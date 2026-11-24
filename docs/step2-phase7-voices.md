# Step 2, phase 7: better cue voices

Do this after phase 6. Same rules as before: report and commit after each part, ask before "Don't" items.

## 1. Kokoro voices (built in, offline)
- Use Kokoro-82M v1.0 (Apache-2.0) as ONNX through ONNX Runtime (MIT). All English voices (American and British, female and male). Other languages optional.
- Text to phonemes: use only permissively licensed code and data (MIT, BSD, Apache). No GPL (e.g. no espeak-ng), so set.Line can stay closed-source. Cue text is short and mostly music words (Verse, Chorus, Bridge, Intro, Outro, Tag, Count in, numbers, "All in"...), so make sure those are pronounced right. Add a pronunciation override per show for odd words.
- The model is not committed to git. Download it on first use into the app's data folder (show progress, verify a SHA-256) and cache it in CI. List every licence in THIRD_PARTY.md.
- Runs only when a cue is added or edited, on a background thread: render, trim leading silence, resample once to the show rate, cache. Never during playback.
- Check first: the minimum macOS version of the ONNX Runtime build you use. The 2015 MacBook Pro runs macOS 12. If ORT can't run there, tell me the options before building (e.g. an older ORT, or building it for 10.15+). Section 3 means a show still plays on that Mac either way.

## 2. Your own recordings
- A "Cue words" list per show: a word or phrase (case-insensitive, e.g. "Chorus") mapped to an audio file the user imports (WAV/AIFF/FLAC, any rate, mono or stereo; resampled once like speech). A matching cue uses the recording instead of a voice. A song can override a word.
- Recordings are copied into the show folder. No in-app recording: set.Line is outputs only.

## 3. Cue audio travels with the show
- Store every rendered cue in the show folder (<show>\Cues\, with a small manifest: text, voice, speed, source). Opening the show on another computer plays these exact files, even if that computer lacks the voice or the model. Re-render only when the cue changes.

## 4. Voice menu
- Order: Kokoro voices (grouped American/British, female/male) with the best ones first, then your recorded words, then "Computer voices", then "More voices…". Preview on each.
- New shows default to a Kokoro English voice. Existing shows keep their saved choice.
- Later (not now): blending two Kokoro voices into a custom one.

## Tests
- Every English Kokoro voice renders each common cue word: not silent, sensible length, starts on its bar's exact sample in the engine.
- A recorded word replaces the voice; a song override wins over the show.
- A show copied to a machine without the model plays its stored cues unchanged.
- Cache hit is instant; editing a cue re-renders only that cue.
- Report render time per cue on this PC and on CI Mac.
