# Breaks (9d)

A **Break** is a setlist item that isn't a song: time for a gear change, tuning, talking or an intermission. Code:
`ui/public/breaks9.js` / `breaks9.css`; the band screens in `ui/src/band/client.ts` and `logic.js`.

A setlist keeps its breaks beside its songs (`breaks`, each after a song or at the start), so everything that walks
the songs in order still sees songs only. Breaks travel with the setlist: saving, `.setline` export / import (mapped
to the imported songs), and the backup rig (which sends the setlist as a package).

## Adding one
- **＋ Break** in the setlist sidebar (Gear change 0:45 · Tuning 0:45 · Talk 1:30 · Intermission 10:00 · Custom…),
  File › Add break (⌘B), Setlist › Add break.
- It goes after the selected setlist item (a song or a break), or at the end.
- Drag a break onto a song (it goes after it) or onto another break (before it). Right-click: Duplicate, Delete.
- The Ableton import makes breaks from GTR CHANGE-style locators (9a: kept as pending until now; they become Break
  items when the setlist opens).

## In the setlist
A hatched row with a dashed outline: ⏸, the label, the length. Breaks have no number. The footer counts them and
adds their time ("3 songs · 2 breaks · 52:40"). They also show in Perform's setlist, on the band screens' setlist
widget and on the printable setlist (a thin row: "— Gear change 0:45 · note").

## The break's panel
Label (Gear change · Tuning · Talk · Intermission · Custom…, up to 24 characters), length (m:ss), a note for the band,
**When the time runs out** (Wait for Play, the default · Start next song), **During the break** (Silence, the default ·
Play a loop / pad: a section of a song, looping at its own level, faded out over 2 s before the next song starts),
**Send the next song's presets at the start of the break** (off by default).

## Playing through a break
- When a song with a break after it ends (Stop, Segue or Auto-next), or you press Next, the break becomes current
  and the countdown starts. No next song is queued in the engine meanwhile (no segue into it).
- The transport shows the label and the time left (the ring counts down); Perform shows the label, a huge countdown,
  a progress bar, the note and "Next: … press Play when ready" (or "starts automatically in 0:32"); the band screens
  show the same over the whole screen.
- Wait for Play: when it runs out, the countdown turns red and counts up ("+0:12", over) until Play.
- Play starts the next song at once (with Start next song, Play starts it early). Stop pauses the countdown (again:
  resumes). Next skips the break; Previous goes back to the song before it.
- MIDI clock: stopped during a silent break (it runs again with the next song); running while a loop plays.
- Pedals: Play / Next / Previous work on breaks (around a break the page decides, not the fast path); "Skip break"
  is a learnable control.
- Until next change counts a timed break's length; a Wait-for-Play break makes the time unknowable ("after <song>").
