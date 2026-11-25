# Importing Ableton Live projects

**File › Import Ableton project…**, or drop a `.als` file on the window (the Library panel too). set.Line reads the
project, shows what it found, and copies nothing until you press **Import**. The project and its files are only read,
never changed.

Live 10, 11 and 12 Sets are supported. Code: `app-gui/AbletonImport.cpp` (the reader), `ui/1-arrange.html` (preview,
songs), `ui/src/pages/arrange.ts` (`importAbleton`). Test: `set.Line --ableton-test <dir>` (synthetic projects, in CI).

## What comes in

| Live | set.Line |
|---|---|
| Master tempo + its automation (steps and ramps) | The song's tempo map, **one tempo per bar**: every bar line lands exactly where Live has it (a ramp becomes each bar's average tempo; the music inside a ramping bar is not re-timed, set.Line never stretches). |
| Time signature changes | Meter changes. A change that isn't on a bar line starts a short bar there (with a note). |
| Locators | Sections (Intro, Verse, Pre, Chorus, Bridge, Outro, Count-in… by name; anything else: type **Other** with the locator's name). Not on a bar line: the nearest bar, with a note. |
| Audio tracks, arrangement clips | One set.Line audio track per file (a Live track that uses several files becomes "Name", "Name (2)"…). Clip start / end, sample offset, looping clips (laid out pass by pass), clip gain, fades, deactivated clips (muted). |
| Track volume, mute, colour, name | A gain trim, mute, the nearest set.Line colour, the name. |
| Group tracks | Flattened: "Vox / BGV 1". The group's volume and mute carry down. |
| Warped clips | Imported when they play at their own speed (the warp markers match the arrangement tempo). One that would need stretching (or transposing) still comes in, flagged: *"This clip was time-stretched in Ableton. Bounce/export it at the song's tempo and replace the file."* |
| MIDI tracks, arrangement clips | Notes (with length and velocity), the clip's Bank (MSB / LSB) + Program Change at the clip's start, CC envelopes in clips (each point, and 16ths along a ramp). |
| A MIDI track's output | The set.Line MIDI port with the same name; none: unassigned, with a note. |
| Samples | Copied into the Library by content (the same file twice is stored once). Found at their path, relative to the project, or by name in the project folder, its parents (2 levels) and the folders beside it; still missing: **Locate…** searches a folder you pick. |

**Not imported** (listed in the preview): devices, plug-ins, return and master effects, automation other than tempo,
meter and clip CCs, Session View clips, video. set.Line is playback only.

Assumptions to check with a real project: Live stores clip fade lengths in beats (read as beats); a MIDI clip's
Program / Bank values are stored 0-based (sent as stored); MIDI controller envelopes map `ControllerTargets.N` to CC
N − 2 (0 is pitch bend, 1 channel pressure).

## Songs from a project

**Songs from** in the preview:

- **Automatic**: AbleSet's notation when the project uses it (any `>` section locator or a `STOP` / `SONG END`),
  otherwise one song.
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
- Sections defined on a "Sections track" (MIDI clips, AbleSet's `+SECTIONS` track flag) are not read yet; use
  section locators.

## Duplicates

A song whose name and audio (content hash) are already in the Library is marked in the preview: **Skip** (the
default), **Import as a new version** (when the tempo map is the same: its arrangement becomes a version of the
existing song, its clips on the tracks that play the same files), or **Import as a new song**.

## After the import

A summary lists every song, its notes, missing samples and what wasn't imported; **Show in Library** opens the
first song. The summary is also appended to `ableton-import-log.txt` in the Library folder (next to
`migration-log.txt`).
