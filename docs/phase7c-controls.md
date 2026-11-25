# Phase 7c: Footswitch and MIDI controller control (MIDI-learn)

**Why:** on stage, the band controls playback with footswitches and MIDI controllers, not the laptop. Any MIDI controller or pedal must be able to trigger any set.Line action.

---

## 1. MIDI input

- set.Line opens MIDI **input** ports: any class-compliant port, USB, Bluetooth (via the OS), and virtual ports (IAC / loopMIDI).
- **Input is handled off the audio thread.** Actions go through the same lock-free command path as keyboard shortcuts.
- **Target:** an action takes effect within one audio block of the message arriving.
- Ignore set.Line's own outgoing messages if they loop back (e.g. a port that echoes). Never react to clock or active sensing.

## 2. Actions

Use the single action list from 6e/6g, and extend it so everything a performer needs is there:
- Play/Stop toggle, Play, Stop
- Next song, Previous song
- Next version of the next song, Previous version of the next song
- Jump to next section, Jump to previous section, Jump to section by number (1–16), Cancel queued jump
- Vamp (toggle), Exit loop
- Sync MIDI
- Soundcheck (toggle)
- Lock / Unlock Perform
- Status messages (6g: Ready / Need 30 s / Problem), so a pedal can send them

**Never mappable, for safety:** anything that changes outputs, levels, the audio device, or deletes things.

## 3. Learn and mappings (Settings → Controls, a new nav item)

- **The page lists every action.** Each row shows its keyboard shortcut (read-only) and its MIDI mappings, with a "＋ Learn" button.
- **Learn:**
  - Shows "Press a pedal or button…". The next incoming message is captured: port, channel, type (Note / CC / Program Change), and number.
  - Esc cancels.
  - If that message is already mapped to another action, ask before moving it.
- **How messages trigger an action:**
  - Note On (velocity > 0) triggers.
  - A CC triggers when its value crosses up through 64. Options: "Trigger on any value change", and "Momentary: trigger on press and release" (for Vamp hold).
  - A Program Change triggers on that program number.
- **Mapping details:**
  - Multiple mappings per action are allowed.
  - Each mapping can be set to "Any port" or one specific port.
  - **Debounce:** ignore repeats within 150 ms (adjustable).
- **Feedback out, optional per mapping:** set.Line can send a message back to light an LED on the controller when the action's state is on (playing, vamping, looping, locked, synced). Off by default.
- **Storage:** mappings belong to **this computer**, since the controllers are plugged into it.
- **Export/Import mappings** (a small JSON file), so the backup rig (7d) can use the same mappings.
- **"Activity" strip:** a line at the top of the page shows the last incoming MIDI message, which helps setup.

## 4. Where it shows elsewhere

- A small **MIDI-in light** in the top bar flashes when a mapped message arrives.
- The Perform screen briefly shows the action name when a pedal triggers something, e.g. "⏭ Next song (pedal)".

## 5. Tests

- **Unit tests for the mapping engine:** note, CC threshold crossing, momentary, PC, debounce, port filter, learn conflicts.
- **An integration test with a virtual MIDI port** (where the CI platform allows; otherwise a simulated input): send a mapped CC, and the action fires within one block.

## Done when

- Tests pass and CI is green.
- The final report has simple steps for the user to map a real footswitch.
