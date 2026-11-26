# Phase 8b: Ableton import follow-ups (from the real EIA 2026-2027 project)

The real project imported well, but its click and cues didn't come across. In Live they are MIDI tracks playing Drum Racks / Simpler:
- **CLICK** (the band's click)
- **DRUM CLICK** (the drummer's click)
- **Qs** (spoken cues)

So imported songs currently have no click and no cues.

**Rules that still apply:**
- **Read-only** on the user's project and drive.
- Test against `D:\2025-2026\EIA 2026-2027 Project\EIA 2026-2027.als` into a **test library** only.
- Never touch the user's main library unless they ask.

---

1. **CLICK → a set.Line Click track**
   - Detect click MIDI tracks by name (CLICK, CLK, METRONOME…) or by a Drum Rack / Simpler loaded with a metronome-like sample.
   - Their note pattern becomes a set.Line click region, using the song's tempo map.
   - **Accent:** take it from the notes, where a higher note or higher velocity on beat 1 means accent; otherwise use the default.
   - **Off-beats:** if the notes fall on 8ths/16ths, set off-beats to match.
   - Only where the MIDI clips exist, so a song's click starts and stops where it did in Live.
   - Output: the next free output, or the existing Click output, using the usual 6d rule.

2. **DRUM CLICK → a second Click track named "Drum click"**, built the same way. The 6d plan already allows several click tracks, e.g. a different click for the drummer on another output.

3. **Qs → set.Line cues**
   - Each note in the Qs MIDI clips becomes a cue at that position.
   - **The cue's words** come from the Drum Rack pad that note triggers: use the pad's chain name, or else the loaded sample's file name without extension. For example, the pad "VERSE" or "verse.wav" becomes the cue "Verse"; "1"–"4" or "count" style pads become count-in words.
   - **If the pad's sample exists in the project**, offer "Use your recorded cue audio" (default ON). The sample becomes a set.Line **recorded cue word**, so the user hears exactly the same voice as in Live. Otherwise cues are spoken with the current voice.
   - Apply the count-in timing rules from 7a, onset on the beat.
   - Document the pad → word mapping in `docs/ableton-import.md`, and show it in the import preview as an editable table ("Pad / note → cue words").

4. **Songs with no sections** (7 in the EIA project: Line Check, Proxima, Death Avenue, End of Heartache, Hourglass, Garden, Garden (Extended Intro))
   - If the song has Qs cues, offer a button in the preview and in the song panel: **"Make sections from cues"**. Each section cue ("Verse", "Chorus", "Bridge"…) starts a section of that type. Count-in cues are ignored.
   - Off by default; the user chooses per song.

5. **Track naming option:** "Name tracks after their audio file", off by default, as a checkbox in the import preview.
   - The real project has misleading names, e.g. "33-hof sb SNARE BOMB" plays "hof BACK TRACK.wav", and two tracks are named "proxima studio guitar".
   - Also strip Live's numeric prefixes ("33-", "54-") when the option is on.

6. **Re-test on the real project** into a fresh test library. Report per song: the click tracks created, the cue count and words (first 10), whether recorded cue audio was used, and the sections made from cues if any.

## Done when
- Fixture tests cover click/drum click/Qs conversion, including a Drum Rack with named pads and samples.
- The real-project re-test report is in the final report.
- CI is green. Commit and push.
