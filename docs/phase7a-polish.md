# Phase 7a: Polish from real use (13 notes)

These notes come from the user testing build 0.1.40 on the band's playback Mac and on the PC.

**The band's Mac is the show machine:** a 2015 MacBook Pro, Intel i7-4770HQ, 16 GB, macOS 12.7.6.

Mockups:
- `docs/design/perform/perform.html` and `p1-perform-redesign.png`
- `docs/design/rounded/rounded-headers.html` and `.png`

**Still true. Do not break any of these:**
- no resampling
- RT-safe audio thread
- atomic saves
- the Library
- satellites never touch levels

---

1. **Startup speed** (target: under 3 s to a usable window on the 2015 MacBook)
   - Measure every startup step (audio device open, web UI load, Library load, last setlist, peaks, voices) and write the times to the log, plus a "Startup" line in Copy diagnostics so the user can paste the numbers.
   - Start the audio device and the web UI at the same time, not one after the other.
   - Load waveforms/peaks and voices after the window is visible.
   - The loading screen must never wait on a fixed timer longer than the work takes.
   - Report the before/after numbers you can measure: CI Mac plus the user's next diagnostics.

2. **Log typo:** "6 audio tracks have no audio file yet, so they plays silence" should say "…so they play silence". Check the other plural/singular messages too.

3. **Reference machine:**
   - The 2015 Intel MacBook on macOS 12 is the show machine.
   - Keep macOS 12 + Intel support in every build; CI must fail if the Mac build's minimum OS goes above 12 or Intel is dropped.
   - Performance targets are judged on that machine.
   - Add this as a rule in `README.md` / `docs/building-the-app.md`.

4. **Perform redesign** (mockup `docs/design/perform/`)
   - **This replaces the old canvas-style Perform page completely.** Perform becomes a fixed layout built for playing live. Custom canvases live only on the Band page.
   - **Top bar:** the same as the Show view's, plus Sync MIDI, the setlist picker, the audio pill, **Lock** (ignores clicks and taps on the page until unlocked; keyboard/footswitch still work) and ⚙.
   - **"Now playing" card:**
     - song name, version, song time left
     - BPM / meter / key / "Then" (transition)
     - the full section timeline: every section coloured and labelled with bars and patch, the current one outlined, the playhead, ↻ loop and Ⅱ hold icons; tap a section to queue a jump
   - **A row of three cards:**
     - current section (name in its colour, a huge bars-left number, beat lights)
     - next section + queued jump (with cancel)
     - "MIDI now" (the current patch per MIDI track)
   - **Setlist on the right:** version names, ‹ › on songs that have versions, transitions between rows, curfew. No overlapping elements.
   - **Bottom dock:** Prev, large Play/Stop, Next, Exit loop (dimmed when no loop), Vamp, jump timing (Next bar / Section end / Now). **Use proper SVG icons, never emoji.**
   - **Remove:** Edit canvas, Style, the DR/KY chips, stem mute buttons, the duplicate big section block, and Resend (Sync MIDI covers it).
   - It must fit 1280×800 and larger, and scale up for big screens.

5. **Voice download visibility:** when the set.Line (Kokoro) voices aren't downloaded, show a visible "⬇ Download better voices (size)" button in the Cues track's Voice card, not only inside the dropdown. Keep it in Settings → Voices too.

6. **Bug: voices don't appear on Mac**
   - **Seen on:** Mac 0.1.40. Diagnostics said "Kokoro voices: ready", but the Voice picker didn't list them, even after a restart.
   - Find and fix it.
   - Add a test: once the model state is ready, the picker lists the Kokoro voices.

7. **Voice picker groups:** two clear groups.
   - **"set.Line voices"** (Kokoro), each showing accent and gender (e.g. "Heart · American · female"). Before the download, this group shows the download item instead.
   - **"Mac voices" / "Windows voices"** (the computer's own).

8. **Sync MIDI is one button only.** Remove the per-device Send buttons and the "Send when this setlist opens" / "Send when a MIDI device reconnects" options added in 6g. The user wants a single button that fires everything. Keep "Fill from first song" and the green "Synced ✓" state.

9. **MIDI clock timing**
   - The clock-on soak failed on one 38 ms outlier.
   - **Find the cause:**
     - log each late event with its type, the scheduler's wake time vs target, and what the thread was doing
     - check whether clock ticks queue behind or delay other events
     - consider giving clock its own scheduling path, so a stalled clock tick never delays a program change
   - **While the user is away:** run a 60-minute soak on the PC (ASIO, buffer 128, X6mini, `--midi-clock`) with the machine idle (no builds during it), and report the numbers. Target: max under 2 ms.
   - **Write `docs/mac-soak.md`:** exact, tested steps for the user to run the same soak on the band's Mac using the IAC Driver:
     - Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver → "Device is online"
     - `setline-update --spike`
     - make the test song
     - the exact `setline-spike` command with the iD14 at buffer 128, the IAC port and `--midi-clock`

     Verify the flags against the real Mac spike.

10. **No interface at launch → This computer**
    - If the last-used interface isn't connected at launch, switch to **This computer** automatically, with a clear banner: "<interface> not found, playing on this computer".
    - When that interface is plugged in later, switch back automatically, **only while stopped**, with a toast.
    - Mid-song behaviour is unchanged: stop and warn; never jump to the laptop speakers while playing.

11. **Click edits during playback:** adding or extending click track regions while playing must be heard when the playhead reaches them, without restarting playback and without a glitch. Add a test. (Only the click needs this.)

12. **Count-in cues on the beat**
    - Kokoro words start slightly late, because of leading silence and the attack before the vowel.
    - When rendering cue audio: trim leading silence, detect each word's perceptual onset (energy/vowel onset), and offset the start so the onset lands exactly on the beat. Do it per word for count-ins, and for recorded cue words too.
    - Add a per-voice "Timing nudge" (± ms) in the Voice card.
    - Check the Mac/Windows voices as well.
    - Test: render "1 2 3 4" at 120 BPM; each word's onset is within 2 ms of its beat.

13. **Rounded headers** (mockup `docs/design/rounded/`)
    - The song header, every track header and every track lane get rounded corners (about 9–10 px), with a small gap (5–6 px) between rows.
    - The colour tab follows the rounded left edge, and clips stay rounded inside the lanes.
    - Keep everything aligned, with no wasted height.

## Done when

- All 13 are done.
- Tests pass and CI is green on Windows and Mac.
- The PC 60-min clock soak numbers are in the final report.
- Commit and push.
