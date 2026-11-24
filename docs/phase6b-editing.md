# Phase 6b: editing fixes (and the order around it)

Phase 6 results: 1-4 passed. MIDI untested (the iD14 has no MIDI out). Click sounds great. Cues, split and
save need work (below).

Order:
- (A) Finish phase 7 part 1 with the change below, test and commit.
- (B) Do the editing fixes as "phase 6b": one commit per numbered item, a short report after each.
- (C) Then phase 7 parts 2-4.

## (A) Kokoro download
- Never start it automatically.
- Show "Download better voices (353 MB)" in the Cue voice panel and the voice menu, with progress and
  Cancel.
- Kokoro voices show "not downloaded" until then; cues use the computer voice meanwhile.
- Add docs/before-public-beta.md with: confirm the provenance of misaki's dictionaries, or replace them
  with our own cue-word list plus CMUdict.

## (B) Phase 6b: editing fixes

### 1. Grid + zoom
- Grid sizes: bar, 1/2, 1/4, 1/8, 1/16, triplet values, and Auto (follows zoom). Selector in the edit
  toolbar.
- Snap on by default, a toggle in the toolbar; hold Alt while dragging to bypass.
- Snapping applies to everything placed or moved: audio clips, splits, fade handles, sections, cues,
  MIDI clips/events, click clips/notes, loop points, ruler clicks.
- Grid lines drawn at the current size, following tempo and meter changes.
- Zoom in much further, so single beats and 16ths are comfortably wide.

### 2. Click
- A new click clip is 1 bar long, not the whole song.
- Copy/paste/duplicate work on click clips. Ctrl/Cmd+D places the copy right after the original.
- "Repeat…" on a clip: N times, or until the next section.
- Multiple click tracks (e.g. "Click (band)" and "Click (drums)"), each with its own clips, sound, level
  and output routing (routing by track name, as today). The engine plays all of them sample-exact.
- Add a self-test check with two click tracks on different outputs.

### 3. Cues
- Cues can sit on any grid position (bar + fractional beat), not just bar starts. Keep old sessions
  working.
- "Add count-in…" dialog, everything adjustable:
  - the bar it leads into;
  - the number of counts (default = the meter's beats);
  - spacing (every beat / every other beat / 8ths);
  - the words (default numbers; custom allowed, e.g. "1, 2, ready, go");
  - the voice.
- The count-in creates normal cues the user can edit afterwards.
- Self-test: count-in cues start on their beats' exact samples.

### 4. Split workflow
- A single click (no drag) on a clip's waveform moves the playhead there (snapped) and selects the
  clip, so S splits right there. Dragging still moves the clip.
- The Split tool cuts where clicked, snapped.

### 5. Save / open
- The user couldn't find save/open at all. Add a visible File menu (New, Open, Open Recent, Save,
  Save As, Close) plus buttons in the top bar.
- A "Not saved" marker; asks to save on close/new/open with unsaved changes.
- Confirm Ctrl/Cmd+S and +O work.
- Test: build a song from stems, save, quit, reopen, and it plays identically.

Keep the mockup look; same real-time rules as before. In the final 6b report, give a short manual test
checklist for items 1-5.
