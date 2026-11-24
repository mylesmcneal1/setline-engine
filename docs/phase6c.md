# Phase 6c

Order:
1. Finish the queued app icons + loading screen (docs/branding-and-loading.md) and report.
2. Phase 6c below: one commit per item, a short report after each.
3. Then phase 7 parts 2-4.

Same rules as always: real-time safety, no resampling of stems, keep the design.

## 1. Fast Save As
Today it's extremely slow because of copying audio, and it froze.
- Copy with the OS's own file copy (CopyFileEx on Windows; copyfile/clonefile on macOS), several files in
  parallel, on a background thread.
- Never copy a file that's already identical at the destination. Plain Save never recopies audio.
- The session file saves immediately. The window shows "Copying audio… 6 of 16" with progress and stays
  responsive.
- Quitting waits for (or safely cancels) the copy.
- Test: speed within ~20% of a plain Explorer copy of the same files.

## 2. Crash safety + startup
I force-closed during Save As; set.Line then wouldn't open because its process was still running invisibly.
- Saves are atomic (write a temp file, then replace), so a show is never half-written.
- An interrupted audio copy is finished or cleaned up the next time the show opens.
- Closing always fully quits (cancel background work and exit, never linger without a window).
- A second launch brings the running window to the front.
- If the last show fails to open at startup, set.Line still opens, says why, and offers Retry / Open
  another / New show.
- A log file per run (see 3).

## 3. Standard folders (no installer yet)
- Shows: Documents\set.Line\Shows\<Show>\ (Mac: ~/Documents/set.Line/Shows).
  - New and Save As default there and just ask for a name.
  - Another place is still allowed.
  - The default folder is changeable in Preferences.
- Documents\set.Line\Library\ for reusable things (cue words, MIDI presets, click sounds).
- Settings + recent list: %APPDATA%\set.Line (Mac: ~/Library/Application Support/set.Line).
- Caches, models, logs: %LOCALAPPDATA%\set.Line (Mac: ~/Library/Caches/set.Line and ~/Library/Logs/set.Line).
- Move existing settings/caches to these places once, without losing anything.

## 4. Automatic backups
- Each save keeps a copy of the session file in <Show>\Backups\ (last 10, timestamped; session file only,
  not audio).
- File > Open Backup… lists them.

## 5. Multi-select
- Shift+click and Ctrl/Cmd+click add or remove items. Drag a box on empty space to select across tracks.
  Ctrl/Cmd+A selects all in the song. Esc clears.
- Works on audio clips, MIDI clips, click clips and cues, mixed.
- Editing the selection:
  - move together (spacing kept, snapped by the first item);
  - Ctrl/Cmd+D duplicates the group right after the selection;
  - copy/paste at the playhead, keeping each item's track;
  - Delete removes all.
- The inspector shows "N items" with shared settings (mute, clip gain…).

## 6. Track settings in the right panel
Clicking any track header opens its settings there (the ⚙ buttons stay as shortcuts):
- Audio: name, colour, output (show-wide or this song), level, mute/solo.
- Click: sound, accent sound, accent/beat/subdivision levels, output, preview.
- Cues: voice, speed, recorded words, output, preview.
- MIDI: port, channel, device profile, alternate in use.

## 7. Glue (Ctrl/Cmd+J) on selected clips of one track
- Neighbouring pieces of the same file with no gap and matching gain/no inner fades: rejoin as one clip,
  no new audio.
- Anything else: render the selected span (gains, fades, silence in gaps) to a new WAV in the show's Audio
  folder at the show rate, replacing the clips. It must sound identical.
- MIDI and click clips: merge into one clip keeping all events.
- Undo restores the separate clips.
- Engine test: glued audio renders sample-identical to before.

## 8. Delete several songs at once
- Multi-select songs (Shift/Ctrl/Cmd+click) in the song list, the "Not in this set" list and the song
  folder rows.
- Delete key or right-click > "Delete N songs…": one confirmation naming them; undo restores them.
- In a setlist, offer "Remove from this setlist" (songs stay in the show) or "Delete from show".
- Audio files are never deleted by deleting songs.
- Add File > "Clean up unused audio…": lists unused files in the show's Audio folder with sizes and
  deletes only after confirmation.

At the end: a short manual test list for 1-8, plus the click tests from 6b not done yet (two click tracks on
separate outputs, Repeat, Ctrl+D).
