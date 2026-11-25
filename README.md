# set.Line engine spike

Copyright (c) 2026 mylesmcneal1. All rights reserved. No license is granted to use, copy, modify or distribute this software (see [LICENSE](LICENSE)).

A small command-line program to answer one question before any more UI work:

**Can set.Line play many stems out of a multi-output interface and fire MIDI patch changes
exactly on time, for a whole show, without a single dropout — on both Windows and macOS?**

The two machines to prove it on: the Windows PC (where it's built) and the 2015 MacBook Pro
(the oldest, slowest Mac it has to support).

It plays a song folder (stems + `song.json`) out of any audio interface (class-compliant or with its own driver),
generates the click, and sends program changes / CCs / notes to your Quad Cortex and Axe-Fx,
then reports dropouts and MIDI timing.

## What's inside

| Part | What it does |
|---|---|
| `core/` | The playback engine in plain C++ (no JUCE): tempo map, disk streaming, click, MIDI scheduling. Real-time safe: the audio callback never locks, allocates or touches a file. |
| `app/Main.cpp` | The command-line app. JUCE only handles the audio device, MIDI ports and reading WAV/AIFF/FLAC files. |
| `tests/core_test.cpp` | Builds without JUCE. Proves stems, click and MIDI land on the exact same sample. |
| `core/Platform.cpp` | The only OS-specific code in the engine: 1 ms timers and "Pro Audio" thread priority on Windows, real-time thread class on macOS. |
| `.github/workflows/build.yml` | Builds a Windows exe and a universal macOS binary (Intel + Apple Silicon, macOS 10.15+) on every push, and runs the tests on both. |

**Rule: the show machine is a 2015 Intel MacBook Pro on macOS 12.** Every build must keep Intel and macOS 12
support (CI fails if the Mac build's minimum OS goes above 12 or Intel is dropped), and performance targets are
judged on that machine. See `docs/building-the-app.md`.

How the timing works: every position comes from one tempo map, rounded one way, so a stem,
the click and a MIDI event set for "bar 9 beat 1" all resolve to the same sample. Stems stream
from disk into a 2.7 s buffer per stem on a background thread. MIDI can't be sent from the
audio thread, so the audio callback works out the moment each event's sample will leave the
interface (callback time + buffer + output latency) and a separate high-priority thread sends it
at that moment, measuring how late each send was. The engine never resamples or time-stretches:
if a stem's sample rate doesn't match the interface, it refuses to play and tells you why.

## Building on the Windows PC

1. Install **Visual Studio 2022 Community** with the *Desktop development with C++* workload
   (it includes CMake), and **Git for Windows**.
2. **ASIO (recommended).** Most audio interfaces reach low latency on Windows through their
   maker's ASIO driver. Download the free **ASIO SDK** from Steinberg's developer site, unzip it
   (e.g. to `C:\SDKs\asiosdk`), and pass its folder when configuring. Without it, the program
   still runs on WASAPI, which works with every interface Windows sees.
3. In *x64 Native Tools Command Prompt for VS 2022*, inside this folder:
   ```
   cmake -B build -DSETLINE_ASIO_SDK_DIR="C:/SDKs/asiosdk"
   cmake --build build --config Release
   build\setline-spike_artefacts\Release\setline-spike.exe --selftest
   ```
   The first configure downloads JUCE (a few minutes).

Before testing on Windows: set the power plan to *High performance*, plug the laptop/PC into power,
and close any app that has the Quad Cortex or Axe-Fx MIDI port open (on Windows a MIDI port can
usually only be opened by one program at a time).

## Getting a Mac build (from the Windows PC)

1. Create a new **private** GitHub repo, e.g. `setline-engine`, and push this folder to it:
   ```
   git init
   git add .
   git commit -m "Engine spike"
   git branch -M main
   git remote add origin https://github.com/<you>/setline-engine.git
   git push -u origin main
   ```
2. On GitHub, open **Actions → build**. When it goes green (about 10 minutes, mostly downloading JUCE),
   open the run and download **setline-spike-macos** under *Artifacts*.
3. Copy it to the MacBook, then in Terminal:
   ```
   mkdir ~/setline-spike && cd ~/setline-spike
   unzip ~/Downloads/setline-spike-macos.zip
   tar -xzf setline-spike-macos.tar.gz
   xattr -d com.apple.quarantine setline-spike   # unsigned test build: tell macOS it's OK
   ./setline-spike --selftest
   ```

The GitHub build also produces **setline-spike-windows** (WASAPI only, since the ASIO SDK can't be
downloaded automatically). Build locally with the SDK for ASIO.

### The set.Line app

The same run builds the desktop app (see `docs/building-the-app.md`):

- **set.Line-macos**: `set.Line.app` (Intel + Apple Silicon, macOS 10.15+). Unzip it, move it to
  Applications, then, because it's an unsigned test build, in Terminal:
  `xattr -dr com.apple.quarantine /Applications/set.Line.app` and open it.
- **set.Line-windows**: `set.Line.exe` (WASAPI only; build locally with the ASIO SDK for ASIO).
  Needs the WebView2 runtime, which Windows 10/11 already have.

## The tests, in order

Any audio interface works: set.Line only cares how many outputs the driver reports and what sample
rate it runs at. Run the same tests on both computers with whatever interface you'll use live. Set it
to **48 kHz** (Mac: *Audio MIDI Setup*; Windows: the interface's own control panel). Connect the MIDI cable(s) to the Quad Cortex / Axe-Fx (or any
MIDI monitor). On Windows the program is `setline-spike.exe`; the commands are the same.

**1. Self-test** — no hardware needed.
```
./setline-spike --selftest
```
Must end with `ALL CHECKS PASSED`.

**2. See what the Mac sees**
```
./setline-spike --list
```
Check your interface shows the number of outputs you expect and that your MIDI ports are listed. On Windows the same
interface can appear several times, once per driver (ASIO, Windows Audio, Exclusive Mode...).

**3. Make a test song** (9 stems, 4 minutes, 48 kHz, 24-bit; about 590 MB of WAVs)
```
./setline-spike --make-test test-song --stems 8 --seconds 240
```
It has a tempo change, a bar of 7/8, a meter change back to 4/4 and a slowdown to 96 BPM.
Outputs: music on 1/2, a timing **marker** on 3 (a 2 ms blip on every downbeat), the **click** on 4.
MIDI: program changes 0–3 at bars 1, 9, 10 and 17 on channel 1, plus a probe note (C4, ch 16) on
every downbeat. Edit `test-song/song.json` to move any of that.

**4. Play it**
```
./setline-spike --play test-song --device "<part of your interface's name>" --buffer 128 --midi-port "Quad"
```
Leave out `--device` to use the computer's default output. On Windows it picks ASIO automatically when available; force a driver with `--driver ASIO`,
`--driver Exclusive` or `--driver "Windows Audio"` to compare them.
Enter = play/stop, `q` + Enter = quit. You should hear the click, see the QC change patches at
bars 1, 9, 10 and 17, and see a status line every second.

**5. Your real stems.** Make a folder with a song's stems and a `song.json` (copy the test one and
edit it). Stems must be mono or stereo WAV/AIFF/FLAC at the interface's sample rate.

**6. Soak test** — the one that matters. Plug the laptop in, close everything else, and run a full show's worth:
```
./setline-spike --play test-song --device "<part of your interface's name>" --buffer 128 --soak 60
```
Ends with `RESULT: PASS` or `RESULT: FAIL`. Try `--buffer 64` too.

**7. MIDI timing against the audio (loopback).** Record two things at once in any DAW on another
computer (or the same one): output 3 (the marker) into an audio input, and the MIDI probe notes
into a MIDI track. Zoom in on a downbeat: the MIDI note should start within about 1 ms of the
marker blip. If it's consistently early or late by the same amount, pass that as
`--midi-offset <ms>` (positive = later) and re-check.

## Pass criteria

| Check | Pass |
|---|---|
| Self-test | `ALL CHECKS PASSED` |
| Soak, 60 min, buffer 128, 9+ stems, on **both** computers (Windows on ASIO if your interface has it) | 0 xruns, 0 disk underruns, 0 MIDI dropped, worst MIDI lateness < 2 ms, no callback over 70% of its budget |
| Patch changes | QC / Axe-Fx switch on the right bars every time |
| Loopback | MIDI within ±1 ms of the marker after calibration, and the same every bar |

If all of that passes on the Windows PC and the 2015 MacBook Pro, the engine approach is proven and
we build the real app on it. If something fails, the summary tells us which part (disk, CPU, or MIDI timing) to fix.

## song.json

```json
{
  "name": "Glasshouse",
  "tempo": [
    { "bar": 1, "bpm": 92, "sig": [4, 4] },
    { "bar": 25, "sig": [7, 8] },
    { "bar": 27, "sig": [4, 4] },
    { "bar": 41, "bpm": 96 }
  ],
  "stems": [
    { "file": "Drums.wav", "out": [5, 6], "gain_db": 0 },
    { "file": "Bass.wav",  "out": [7],    "gain_db": -1.5 }
  ],
  "click": { "out": [1], "gain_db": -6 },
  "midi": [
    { "port": "Quad", "bar": 1,  "beat": 1, "ch": 1, "type": "pc", "program": 12 },
    { "port": "Quad", "bar": 25, "beat": 1, "ch": 1, "type": "cc", "cc": 43, "value": 2 },
    { "port": "Axe",  "bar": 41, "beat": 1, "ch": 2, "type": "pc", "program": 5 }
  ]
}
```

- Outputs are numbered from 1, like on the interface. A mono stem with two outputs plays on both.
- `port` is any part of the MIDI port name (`""` = the first one found). `--midi-port` overrides it for every event.
- `beat` can be fractional (`1.5` = the "and" of 1).
- Not in this spike on purpose: tempo ramps (played as jumps), locating mid-song, versions,
  the satellite web server, the UI. Those come once the engine passes.

## Shipping note: ASIO licence

Using the ASIO SDK for your own testing is fine. Before distributing set.Line to anyone else, it
needs either Steinberg's free proprietary ASIO licence agreement (keeps set.Line closed-source) or
the GPLv3 option (set.Line would have to be open source). Decide before the first public release.

## Commands

```
setline-spike --list
setline-spike --selftest
setline-spike --make-test <folder> [--stems 8] [--seconds 120] [--rate 48000]
setline-spike --play <folder> [--device "<part of name>"] [--driver ASIO] [--buffer 128] [--midi-port "Quad"] [--midi-offset 0]
              [--autoplay] [--loops N] [--soak <minutes>]
setline-spike --render <folder> [--out render.wav]   # offline: all outputs to one WAV + MIDI event list
```
