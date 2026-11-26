# Phase 9d · Breaks in the setlist

Mockup: `docs/design/phase9/d3-break.png`.

A **Break** is a setlist item that isn't a song: time between songs for a gear change, tuning, talking or an intermission. The user didn't want it to be gear-specific, so the type is **Break** and the label says what it's for.

## Adding one
- **The setlist sidebar** has **+ Break** next to + Song. There's also File › Add break (⌘B) and Setlist › Add break.
- **Add ▾ › Break ›** offers the labels: **Gear change · Tuning · Talk · Intermission · Custom…**
- **A new Break** goes after the selected setlist item, or at the end if nothing is selected. The default length is 0:45 for Gear change and Tuning, 1:30 for Talk, and 10:00 for Intermission.
- **Breaks can be dragged** like songs, and duplicated, deleted and selected (select mode, 9b).
- **The Ableton import** creates Breaks from GTR CHANGE-style markers (9a §5).

## In the setlist
- **A hatched row with a dashed outline:** ⏸ icon, label, length. Breaks have no number; songs keep their numbering.
- **The footer total** includes break time ("11 songs · 2 breaks · 52:40").
- **Breaks show everywhere setlists appear:** Perform, band screens, the printable setlist (as a thin row: "— Gear change 0:45 · note"), export/import `.setline` and the backup rig sync (7d).

## Break inspector (right panel, when a Break is selected)
- **Label:** chips Gear change · Tuning · Talk · Intermission · Custom… (custom text, max 24 characters)
- **Length:** m:ss
- **Note for the band:** free text, e.g. "Brett: swap to the baritone · Nick: capo off"
- **When the time runs out:**
  - **Wait for Play** (default)
  - **Start next song:** it starts automatically, with the count-in if the song has one
- **During the break:**
  - **Silence** (default)
  - **Play a loop / pad…:** pick an audio file from the library's media or a song's section to loop, at its own level on the show outputs, fading out over 2 s when the next song starts
- **Send at the start:** optional MIDI, normally the next song's presets/scenes (8c), so modelers change during the break. Off by default; one checkbox "Send next song's presets at the start of the break".

## Playing through a break
- **When a song ends** with a "next" transition (6e Segue/Auto-next), or the user presses Next, a Break becomes current. **The countdown starts immediately.** The transport shows the break label and the time left instead of a bar position, and the progress ring counts down.
- **Perform view during a break:**
  - the label in the accent colour, a **huge countdown** (0:32) and a progress bar
  - the note
  - "Next: HAND OF FATE · 180 BPM · Drop B · press Play when ready" (or "starts automatically in 0:32")
- **Band screens** show the same: the countdown, the note and the next song. The "Until next change" widget treats a break like a song.
- **When it runs out with Wait for Play:** the countdown turns red and counts up ("+0:12 over") until Play.
- **Pressing Play during a break:** with Wait for Play, the next song starts at once; with Start next song, Play starts it early.
- **Stop during a break** pauses the countdown. **Next** skips the break; **Previous** goes back to the song before it.
- **MIDI clock:** stopped during a silent break; running if a loop plays.
- **Footswitch / MIDI-learn** (7c): the existing Play / Next / Previous controls work on breaks. Add one learnable control, "Skip break".

## Tests
- setlist ordering, totals and saving/loading with breaks
- transitions song → break → song, in both "When the time runs out" modes
- the over-time count-up
- Next/Previous around breaks
- export/import and backup-rig sync carrying breaks
- the printable setlist showing them
- band screen messages for a break
