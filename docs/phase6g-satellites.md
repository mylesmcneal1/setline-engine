# Phase 6g: Satellites (band screens), song fields, and MIDI sync/clock

Do this last, after 6d, 6e and 6f.

Mockups are in `docs/design/band/`:
- `dash.html`: call `S('dr')`, `S('gt')`, `pick('sc')`, `pick('until')`, `fields(true)`, `live('dr')` and `live('gt')` in the browser console to see each state
- PNGs `d1`–`d6`
- `d7-walkthrough.mp4`

More widgets are in `docs/design/band/more/`: `widgets.html` and PNGs `w1`–`w4` (music director screen, count-in overlay, tech status buttons + checklist, drummer section buttons + Vamp).

The MIDI sync and clock settings are mocked in `docs/design/library/l6` and `l7`.

**What the user needs:**
- **The drummer's iPad** can start/stop, start a Soundcheck loop, and see song and section info.
- **The guitar tech's tablet** shows the current tuning and guitar, and counts down to the next tuning change.

**The goal:** fully custom dashboards with drag-and-drop widgets and per-song custom text fields.

The user uses up to 2 screens, but the system must work with any number.

**Hard rules:**
- **set.Line outputs playback only.** Monitor mixes happen on the band's digital mixer, so satellites never get level, gain or mute controls.
- **Satellites can never affect the audio.** If a device or the network dies, the show continues. The server runs off the audio thread, and commands go to the engine through the same lock-free path as keyboard actions.

---

## 1. Network and server

- **The setup:** the band runs a closed network (a dedicated router, no internet). The host may be wired to it.
- **The server:**
  - an embedded HTTP + WebSocket server on its own thread
  - the port defaults to 8080, configurable in Settings → Band
  - binds to all interfaces
  - pick a small, permissively licensed library and record it in `THIRD_PARTY.md`
- **Discovery:**
  - Advertise `setline.local` via mDNS: Bonjour on Mac; DnsServiceRegister on Windows 10+ if available.
  - **Always show a QR code** that holds the host's actual IP and port, because Android is unreliable with `.local`. Show it on the Band page and in Settings → Band, with the IP in large text.
- **Windows firewall:** the first listen triggers the firewall prompt. Explain it in a one-line notice on the Band page, and handle "blocked" gracefully, with the reason shown.
- **The client:**
  - a web app served by set.Line from the app bundle: a separate entry in the existing Vite UI build, e.g. `band.html`
  - works in Safari (iPad/iPhone), Chrome (Android) and desktop browsers
  - nothing to install
- **Device identity:**
  - On first connect, a device shows "Which screen is this?" with the list of screens from the Band page, plus "New screen".
  - The choice is remembered on the device (localStorage) and can be reassigned from the host.
  - An optional join PIN in Settings → Band, off by default.
- **Reconnect:** automatic, with backoff. The connection light widget shows the state. When the host is lost, the screen dims and says "Reconnecting…".
- **Screen awake:** use the Wake Lock API where supported. Otherwise show a one-time tip, e.g. iPad Auto-Lock → Never or Guided Access.

## 2. Timing on satellites

- **Clock sync:** an NTP-style ping exchange every few seconds estimates each device's clock offset. Use the median of the last 8 exchanges.
- The host sends state updates about 15 times a second, plus instant events (song change, jump, stop), with host timestamps.
- Clients render beat lights, countdowns and bars-left from the synced clock and the tempo map. They predict between updates, so a laggy Wi-Fi device still flashes on the beat.
- **Unit test:** the offset estimator.

## 3. Band page = dashboard editor (mockups d1–d3)

**Left column:**
- the screens list: name, icon/colour, device type, online state, "＋ Add"
- the QR code and IP
- the band network name, as set by the user (just a label)
- "Song fields: … Edit song fields…"

**Centre:**
- a device-shaped canvas on a 12×9 grid per orientation. Landscape and portrait each have their own layout; the device uses whichever matches.
- drag widgets in from the library, move and resize them by grid cell, delete with the Delete key
- "Start from preset ▾" with Drummer, Guitar tech, Music director, Vocals, Blank
- **every change shows live on the device**

**Right column:**
- the widget library, grouped
- or, when a widget is selected, its settings and "Remove widget"

**Storage:** dashboards belong to the Library (6f).

**Controls are permissions:** a screen can only do what its buttons do. The server checks every command against that screen's layout. The old per-user "Can control" switches go away.

## 4. Song fields (mockup d4)

- **Definitions:** Settings → Band → Song fields: add, rename, delete and reorder. The type is Text or a List of choices (e.g. Tuning: E Standard, Eb, Drop D, Drop C…).
- **Values:**
  - set per song
  - can be overridden per version (6e), with the version value winning
  - edited in the song's right panel ("Fields" card)
- **Song fields table:**
  - opened from the Band page or the song panel
  - one row per song in the current setlist: #, song, version, length, then one column per field
  - you type straight into the cells; Tab and Enter move between cells
  - cells where the value differs from the song before are highlighted

## 5. Widgets

Each widget is resizable. Text scales to fit its size. Widgets that point at a field have a This song / Next song switch.

### Info

- **Song name** (+ version)
- **BPM & meter**
- **Next song** (+ transition)
- **Section timeline** (the current section highlighted)
- **Bars left** in the section
- **Beat lights**
- **Next section + bars until it**
- **Count-in overlay:** goes full-screen "1 2 3 4" while a song's count-in plays. It uses sections of type Count-in; add that section type if it's missing.
- **Change warnings:** meter or tempo changes coming within N bars, e.g. "7/8 next bar", "→ 96 BPM in 4".
- **Song time left / Set time left / Clock**
- **Curfew clock:**
  - each setlist has a "finish by" time
  - it shows over/under, using the remaining songs' real lengths
  - songs set to Stop or Auto-next add their wait times where known, and it shows "+ talking" otherwise
- **Song field** (this/next song)
- **Until next change:**
  - you choose a field, e.g. Tuning; optionally another field to show alongside, e.g. Guitar
  - it finds the next song in the setlist whose value differs, and counts down: remaining time of the current song + the full lengths of the songs in between
  - when a Stop or Auto-next sits in between, it shows "after <song>" instead of a fake exact time
  - it shows the target value, the song it applies to, and a progress bar since the last change
- **Setlist with a field:** the current song is bold and the next change is highlighted.
- **Section notes:** a text field per section, edited in the section panel; shows the note for the current section.
- **Cue feed:** the spoken cue text as it fires.
- **Patch name:** the current program on a chosen MIDI track, using the patch name list if one is set.
- **Text label:** static text.

### Communication

- **Status buttons:**
  - configurable labels, e.g. "Ready", "Need 30 s", "Problem"
  - pressing one broadcasts it to the host (a toast in the top bar and the Perform screen) and to any screen with a **Status display** widget
  - status clears on song change or when tapped again
- **Per-song checklist:** tick boxes with configurable items, per screen. They reset on every song change. Nothing is saved beyond the session.
- **Connection light**

### Controls

Each control has: label, colour, "Ask to confirm" (off by default) and size.

- **Play / Stop**
- **Next song / Previous song**
- **Soundcheck:**
  - plays a chosen Library song/version as a loop, outside the setlist; the set position is kept
  - tap again to stop
  - refused while the set is playing (the button shows why)
- **Exit loop**
- **Vamp:** loops the current section until pressed again, then exits at the end of the current pass. Uses the loop machinery from 6e.
- **Section buttons:** a grid of the current song's sections; tap to queue a jump, using the 6e jump timing.
- **Version flip** (next song)
- **MIDI button:** sends configured messages on a port and channel.
- **Sync MIDI:** see section 6.

**Not allowed on satellites, ever:** any level, gain or mute control.

## 6. MIDI sync point and MIDI clock

### Setlist MIDI sync point

- It belongs to the setlist (6f). Edit it in Settings → MIDI → "Sync point for <setlist>", or from the setlist's right panel.
- It's a list per MIDI device (port + channel) of messages to send: Bank MSB/LSB + Program, CCs, any raw message.
- **"Fill from first song":** copies the opening state of the setlist's first song into the sync point, i.e. the first events on each MIDI track at its start.
- **"Send" button per device** for testing.
- **"Sync MIDI" sends everything:**
  - from a top-bar button, a keyboard action and footswitch mapping (the 6e action list), and the satellite widget
  - each device shows a ✓ when sent
- **Options**, both off by default:
  - "Send when this setlist opens"
  - "Send when a MIDI device reconnects"
- After syncing, songs control the devices normally.
- New setlists copy the sync point from the last setlist.

### MIDI clock

- **On by default on every MIDI output port.** 24 ppqn, scheduled with the same precise timing as other MIDI events, following the tempo map exactly.
- **When stopped,** clock keeps running at the next song's starting tempo, so delays and modulation are already right.
- **Per port in Settings → MIDI:** Clock on/off, and "Send Start/Stop/Continue + Song Position", which is **off by default** because some loopers and drum machines start on their own.
- **Clock must not degrade the existing MIDI timing.** Re-run the MIDI timing self-test and a soak with clock on, and include the numbers in the report.

## 7. Tests

- the clock offset estimator
- Until next change: counting across songs, the Stop/Auto-next case, the field override by version
- curfew math
- the server-side permission check: a command from a screen without that button is rejected
- the MIDI clock: tick count per bar matches the tempo map, including tempo changes; free-running at the next song's tempo while stopped
- sync point "Fill from first song"

## Done when

- The user can join from an iPad and an Android phone on a closed network.
- The drummer layout works: Play/Stop and Soundcheck.
- The tech layout shows the tuning countdown correctly across a whole set.
- Unplugging the router mid-song never affects the audio.
- CI is green and all tests pass.
- The report includes the clock timing numbers.
