# Importing Ableton Live projects

**File › Import Ableton project…**, or drop a `.als` file on the window (the Library panel too). set.Line reads the
project, shows what it found, and copies nothing until you press **Import**. The project and its files are only read,
never changed.

Since 9a the whole import happens in **one window**, in three steps: **1 Sort markers → 2 Options → 3 Import**.
Nothing else opens, re-lays out or flashes behind it; the songs go into the Library in one batch at the end (when
you press Stop, if something is playing), and the summary appears in the same window.

- **1 Sort markers**: every Live locator, with set.Line's guess and the reason in grey (below). Change any of them.
  The choices are remembered per project file, so a re-import offers the same ones.
- **2 Options**: the songs found (tick to import, duplicates, missing samples, Locate…), click / cue options,
  sections from cues, name tracks after their file, the setlist.
- **3 Import**: one progress list: the total (files, GB, time left), then a row per file with its own bar, ✓ when
  done, and "… N more". **Run in background** shrinks the window to a pill in the top bar (click it to open it
  again; the app stays usable). **Cancel** removes the files this import copied (files already in the Library stay).
  A project on a removable or external drive gets the tip *Copy the project to this computer's drive first.*

Live 10, 11 and 12 Sets are supported. Code: `app-gui/AbletonImport.cpp` (the reader), `ui/1-arrange.html` (preview,
songs), `ui/src/pages/arrange.ts` (`importAbleton`). Test: `set.Line --ableton-test <dir>` (synthetic projects, in CI).

## What comes in

| Live | set.Line |
|---|---|
| Master tempo + its automation (steps and ramps) | The song's tempo map, **one tempo per bar**: every bar line lands exactly where Live has it (a ramp becomes each bar's average tempo; the music inside a ramping bar is not re-timed, set.Line never stretches). |
| Time signature changes | Meter changes (9a: any meter, 1-32 over 1/2/4/8/16/32, shown as cyan badges on the ruler). A change that isn't on a bar line starts a short bar there (with a note). |
| Tempo values | Stored exactly, without float noise: a tempo within 0.0005 BPM of a value with at most 3 decimals snaps to it (123.99999999999623 → 124, 179.9884490000081 → 179.988, shown as 179.99; never to 180). Each snap is listed in the summary. |
| Locators | Sections (Intro, Verse, Pre, Chorus, Bridge, Outro, Count-in… by name; anything else: type **Other** with the locator's name). Not on a bar line: the nearest bar, with a note. |
| Audio tracks, arrangement clips | One set.Line audio track per file (a Live track that uses several files becomes "Name", "Name (2)"…). Clip start / end, sample offset, looping clips (laid out pass by pass), clip gain, fades, deactivated clips (muted). |
| Track volume, mute, colour, name | A gain trim, mute, the nearest set.Line colour, the name. |
| Group tracks | Flattened: "Vox / BGV 1". The group's volume and mute carry down. |
| Warped clips | Imported when they play at their own speed (the warp markers match the arrangement tempo). One that would need stretching (or transposing) still comes in, flagged: *"This clip was time-stretched in Ableton. Bounce/export it at the song's tempo and replace the file."* |
| MIDI tracks, arrangement clips | Notes (with length and velocity), the clip's Bank (MSB / LSB) + Program Change at the clip's start, CC envelopes in clips (each point, and 16ths along a ramp). |
| A MIDI track's output | The set.Line MIDI port with the same name; none: unassigned, with a note. A click or cue track played inside Live becomes a set.Line click track / cues (below); any other MIDI track whose output is *None* and that plays an instrument inside Live isn't imported, with a note; a MIDI track with only empty clips (a SONG marker track) isn't either. |
| Samples | Copied into the Library by content (the same file twice is stored once). Found at their path, relative to the project, or by name in the project folder, its parents (2 levels) and the folders beside it; still missing: **Locate…** searches a folder you pick. |

## Click and cue tracks played inside Live (8b)

Many sets play their click and spoken cues from MIDI tracks inside Live. A Drum Rack (or one Simpler) holds the click
sounds or the recorded cue words on its pads, and MIDI clips trigger them. set.Line turns those into its own click
tracks and cues.

A MIDI track whose output is *None* and that plays a Drum Rack or Simpler is one of these:

- **Click track:** its name has *click*, *clk*, *metronome*, *metro* or *tick* (CLICK, DRUM CLICK...), or most of
  its pads or samples are named like a metronome.
- **Cue track:** it's named *Qs*, *Q's*, *Cues*, *Guide* or *Spoken* (or has "cue" in its name), or most of its pads
  are section or count words.

A track with no notes (an empty template) is left alone.

**Clicks.** Each click track becomes a set.Line click track:

- The first one is **Click**.
- One whose Live name has "drum" is **Drum click**, with its own clips, sound, level and output.
- Its notes become click clips, but only where Live's MIDI clips are, so a song's click starts and stops where it
  did in Live.
- Each note keeps its place on the 16th grid, so 8th or 16th off-beats come across as they are.

The accent comes from the first of these that applies:

1. A note that (nearly) always plays on beat 1 when the other notes don't (Live's *MetronomeUp* pad).
2. Louder notes on beat 1.
3. Beat 1.

Outputs follow the usual rule: an existing Click output, else the next free one.

**Cues.** Every note on the cue track becomes a cue at its bar and beat. Its words come from the pad the note plays:

| Live | Cue words |
|---|---|
| The pad's chain name (`verse 1`, `DRUMFILL`) | "Verse 1", "Drumfill": first letter capitalised, the rest lower case |
| No chain name: the pad's sample (`03_Chorus.wav`) | "Chorus": no extension, no number in front, `_` as spaces |
| `one`…`four`, `1`…`8`, `count…` | Count-in words |

A note is matched to its pad the way Live does it: a Drum Rack pad's note is 128 − its *ReceivingNote*. The preview
shows the mapping as a table (**Edit pad / note → cue words**), and every word can be changed there before importing.

**Use your recorded cue audio** is on when the pads' samples are found. Each word then plays its pad's own sample, so
the band hears the same voice as in Live:

- A pad plays only part of its sample (Simpler's start and end). That part is cut into its own file (`Verse 1.wav`)
  and copied into the Library as a recorded word of that song.
- Cues are placed with the 7a rule: the word's onset lands on the beat.
- With the option off, cues are spoken by the current voice.

**Make sections from cues** is off by default. You turn it on per song in the preview, or with the button in the
song panel:

- Each section cue (Intro, Verse, Pre-chorus, Build, Chorus, Bridge, Breakdown, Outro / Ending, Solo, \*drop...)
  starts a section of that type at its bar.
- Count-ins, song-name cues and other cues (Ring out, Drumfill, Vocal start) don't start one.
- The bars before the first section cue become an Intro.

**Name tracks after their audio file** is off by default. When it's on, an audio track takes its file's name instead
of Live's track name, without the extension or a number in front. For example, "33-hof sb SNARE BOMB" playing
`hof BACK TRACK.wav` becomes "hof BACK TRACK".

**Not imported** (listed in the preview): devices, plug-ins, return and master effects, automation other than tempo,
meter and clip CCs, Session View clips, video. set.Line is playback only.

Clip fade lengths are in the clip's own time, like its start and loop points: beats for a warped clip, seconds for an
unwarped one (checked against a real Live 12.4 project: Live's 4 ms clip-edge fade is stored as 0.004 on unwarped
clips at every tempo).

Still to check with a real project that uses them: a MIDI clip's Program / Bank values are stored 0-based (sent as
stored); MIDI controller envelopes map `ControllerTargets.N` to CC N − 2 (0 is pitch bend, 1 channel pressure).

## The end of a song (9a)

Live's tempo automation often steps a little before the next song's locator, so the last bar of a song used to get
part of the next song's tempo. A tempo or time signature change that falls in a song's **last bar**, at or before the
next song's start, belongs to the next song: the song keeps its own tempo and meter to its end, and the next song
starts with the new ones. The summary says which songs this applied to.

## Sort markers (9a)

| Guess | When | Reason shown |
|---|---|---|
| **Ignore** | a name used 3 or more times across the set (e.g. `TERM`); it still ends the song before it | "TERM" repeats 6× across the set |
| **Ignore** | an unnamed locator (it still ends the song before it, as before) | marks the end of SENECA |
| **Break** | a name with GTR, GUITAR, CHANGE, SWAP (Gear change), TUNE, TUNING (Tuning), TALK (Talk), BREAK, INTERMISSION (Intermission), with no audio under it | after MERCY, no audio under it |
| **Marker** | inside a song's audio (a clip runs through it, none starts there, no section starts there) | inside DEATH AVENUE → kept as a marker |
| **Song** | otherwise, a locator that starts a block of audio (or a name on its own) | starts a block of audio |
| **Section** | `> Name` locators and the Sections track's clips | SECTION clip |

AbleSet's own rules still apply first (`*` and ClyphX `[…]` locators, `STOP` / `SONG END`, `[nosong]`).
**Automatic** also treats a project as a whole set when it has unnamed end locators or a name used 3+ times.

- **Markers** become markers on that song's ruler (right-click one to rename or delete it; right-click the ruler ›
  Add marker… adds one).
- **Breaks** go into the imported setlist between their songs. Until set.Line has Break items (9d) they're kept with
  the setlist and become Break items then.

## Songs from a project

**Songs from** in the preview:

- **Automatic**: AbleSet's notation when the project uses it (any `>` section locator, a `STOP` / `SONG END`, or a
  Sections track), otherwise one song.
- **AbleSet locators** (below).
- **One song**: the project's name is the song's name; every locator is a section.
- **Every locator is a song**.
- **Song locators start with +**: `+Name` starts a song; the other locators are its sections.

Each song is the arrangement from its start to the next song's start (or a stop / end locator), moved to start at
bar 1 with the tempo and meter that apply there. Its audio plays from the matching point in each file.
**Also create a setlist from this project** puts the songs in a new setlist named after the project, in arrangement
order.

### AbleSet's locator notation (what set.Line follows)

From AbleSet's documentation, [Locator notation](https://ableset.com/docs/locator-notation) and
[Flags](https://ableset.com/docs/flags) (ableset.app/docs redirects there):

- A plain locator, e.g. `Never Gonna Give You Up`, starts a song ("the simplest form of a locator contains just the
  song title and is located at the song's beginning").
- `> Verse 2` is a section; `>> Chorus` too (AbleSet makes it quick to reach). `Intro >>> Verse 1` is an automatic jump
  in AbleSet; set.Line takes the section's name (the part before `>>>`).
- `SONG END` ends the song there; `STOP` or `AUTOSTOP` stops playback there (both end the song in set.Line). A `.`
  before a song's name (`. Follow Night`) stops before it: in set.Line the previous song ends there anyway.
- `* Check automation`: ignored (AbleSet ignores locators starting with `*`). ClyphX locators (`[STOP] SETSTOP; …`)
  are ignored too.
- `Interlude [nosong]`: not a song; the part up to the next song isn't imported.
- Not part of the name: `{descriptions}`, `#tags`, `[3:20]`-style attributes and `+FLAGS`. `+LOOP` / `+LOOPFULL` on
  a section makes it a **Loop until released** section in set.Line. Other flags (`+PAUSE`, `+SKIP`, `+END`, `+JUMP`,
  `+STAY`) have no set.Line equivalent and are dropped.
- An unnamed locator ends the song before it (set.Line's choice: AbleSet doesn't document it; band sets use them to
  mark where a song stops before the gap to the next one).
- [Sections track](https://ableset.com/docs/sections-track): a MIDI track named `Sections` (set.Line also takes
  `Section`) or with the `+SECTIONS` flag in its name; the first one counts. Each clip on it starts a section named
  after the clip (locator notation and flags such as `+LOOP` work); its length doesn't matter. A section locator at
  the same place wins over the clip. The track itself isn't imported.

## Duplicates

A song whose name and audio (content hash) are already in the Library is marked in the preview: **Skip** (the
default), **Import as a new version** (when the tempo map is the same: its arrangement becomes a version of the
existing song, its clips on the tracks that play the same files), or **Import as a new song**.

## After the import

A summary lists every song, its notes, missing samples and what wasn't imported; **Show in Library** opens the
first song. The summary is also appended to `ableton-import-log.txt` in the Library folder (next to
`migration-log.txt`).
