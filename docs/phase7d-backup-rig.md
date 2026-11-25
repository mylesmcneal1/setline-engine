# Phase 7d: Backup rig (two computers in lockstep)

**Why:** if the show Mac fails mid-set, a second computer running set.Line must already be playing the same thing at the same position. A hardware switcher, or the engineer, flips to it, and the show continues.

**Hard rules:**
- **No resampling or time-stretching**, ever, including for sync.
- **Satellites and the backup can never affect the primary's audio.**
- The networking runs off the audio thread.

---

## 1. Roles and pairing

- **Settings → Backup rig (a new nav item):** Role = Off / Primary / Backup.
- **Pairing:**
  - The backup shows a short code and its IP. The primary enters the code, or picks the backup from a discovered list (reuse the 6g mDNS/QR approach).
  - Pairing is remembered on both computers.
  - Use the same closed band network as satellites.
- **Status, shown in the top bar on both machines:** "Backup: in sync ✓ (offset 0.8 ms)", "Backup: behind", "Backup: missing songs", "Backup: offline".

## 2. Same material on both

- **Library match check:** the primary compares setlists, songs, versions and audio hashes with the backup, and lists any differences.
- **"Send setlist to backup":** one click transfers the current setlist over the network, using the 6f export package format, and the backup imports it. Show progress. It's refused while playing.
- **Settings that are per computer stay separate:** audio device, output names, MIDI ports, controller mappings (7c), though mappings can be imported from a file.

## 3. Lockstep playback

- **The backup follows the primary.** Its own transport controls are disabled while paired, except a clearly labelled "Take over now" button.
- **Clock sync:** reuse the 6g NTP-style offset estimator between the two hosts. Use the median of recent exchanges and keep it running continuously.
- **Every transport action is sent as a scheduled command** carrying the host time at which it happens: "start song S, version V, at position P, at host time T". This covers start, stop, song change, version change, jumps, loops/vamp, exit loop and segues.
  - The primary schedules its own action slightly in the future (e.g. +50 ms) so the backup can hit the same moment. Show this small extra latency in the settings, and allow 20–100 ms.
- **Drift:** the two audio interfaces run on separate clocks, and with no resampling there is nothing to continuously correct.
  - Measure the drift and show it.
  - **Re-align at every song start and every jump.** The backup schedules those against the primary's timeline, so the error never builds up past one song.
  - Report worst-case drift per song in the log.
- **MIDI:**
  - By default, only the primary sends MIDI (program changes, clock, sync).
  - The backup's MIDI output is muted while the primary is healthy, so devices aren't double-triggered.
  - Option per port: "Backup also sends" (for setups with separate devices per rig).

## 4. Failover

- **Heartbeat:** the primary sends one every 100 ms. If none arrives for **500 ms** (adjustable), the backup declares the primary lost. It then:
  - **keeps playing** (it already is), with no audible change
  - **unmutes its MIDI output** and takes over MIDI, sending the current state for the song position, like a Sync MIDI for the current song
  - **sends an optional "failover" MIDI message** (configurable port and message), for switchers or lighting that accept MIDI
  - **shows a large red banner:** "PRIMARY LOST, backup is live"
  - **tells the satellites:** band screens learn the backup's address while paired, and reconnect to it automatically
- **The primary coming back does not take control back automatically.** Show "Primary is back. Return control?" on the backup; the user confirms.
- **"Take over now"** on the backup does the same failover manually.

## 5. Tests

- **Two instances on one machine** (different ports, a null/dummy audio device) in CI:
  - start, jump, version change and segue stay aligned within a few ms by audio-frame position
  - kill the primary, and the backup takes over within 600 ms, unmutes MIDI and keeps playing
- **Unit tests:** the scheduled-command timing math, the drift report, and the heartbeat timeout.
- **For the user's report:** steps to test with the PC as primary and the Mac as backup at home after the trip, ideally both playing into the same mixer so they can hear any offset.

## Done when

- Tests pass and CI is green.
- The report includes the measured alignment numbers from the CI test.
