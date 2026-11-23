# set.Line — Step 1: the app shell

Read this whole file before starting. Work in the phases below, build and test after each one,
commit after each one, and stop and ask before changing anything listed under "Don't".

## Where things are

- `core/` — the playback engine (plain C++17, no JUCE). Real-time rules apply: the audio callback
  never locks, allocates, logs or touches files. Every engine change gets a check in `runSelfTest()`
  (core/TestSong.cpp), and `setline-core-test` must keep passing.
- `app/` — the `setline-spike` command-line test tool. Keep it building and working.
- `ui-mockups/` — the approved interface mockups (plain HTML/CSS/JS), Mac/Windows neutral:
  - `1-arrange.html` the Edit window (mini DAW: song folders, setlists, tempo map, sections, audio
    clips, MIDI clips, click clips, cues, versions, mixer, inspector)
  - `2-routing.html` Outputs & MIDI
  - `3-satellite.html` band-member screens (also the main computer's own Perform view with `?mac`)
  - `4-users.html` Users & Canvases
  - `shared.js` (users, widgets, canvases), `ui.js` (custom dropdowns, Dark/Darker appearance,
    Ctrl vs ⌘ shortcut labels)
  These are the design. Keep how they look and behave. They currently fake playback with a JS timer
  and a WebAudio click; that's what step 1 replaces.

## Goal of step 1

A real `set.Line` desktop app for Windows and macOS: a native window showing the Edit page, where
Play and Stop drive the real engine through the real audio interface. The interface becomes a
view of the engine. JavaScript never drives audio timing.

## Architecture

- New target `setline` in this repo: `juce_add_gui_app`, sources in `app-gui/`, links `setline_core`.
- JUCE 8 `WebBrowserComponent` hosts the UI: WebView2 on Windows, WKWebView on macOS.
  - Windows needs the WebView2 SDK (NuGet package `Microsoft.Web.WebView2`) for
    `NEEDS_WEBVIEW2 TRUE` / `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1`. Install it per JUCE's
    docs, and make CI install it too.
  - Use the native integration from JUCE 8: `withNativeIntegrationEnabled()`,
    `withNativeFunction(...)`, `emitEventIfBrowserIsVisible(...)`, `withResourceProvider(...)`, and
    JUCE's JS helper (`juce_gui_extra/native/javascript/index.js`) on the page side. Check the
    JUCE 8.0.14 sources for the exact API, don't guess.
- UI files live in `ui/` (copy the mockups there; `ui-mockups/` stays untouched as the reference).
  - Add Vite + TypeScript. Existing pages stay plain JS for now; new code (the bridge) is TS.
  - Release builds embed `ui/dist` with `juce_add_binary_data` and serve it through the resource
    provider. A `--dev` flag loads `http://localhost:5173` from `npm run dev` instead.
  - Node is installed on this PC.
- `app-gui/` modules (suggested):
  - `Main.cpp` — JUCEApplication, window, settings (PropertiesFile), menu shortcuts
  - `AudioHost` — AudioDeviceManager + Engine + MIDI outputs, device/driver/rate/buffer choice
  - `Bridge` — every native function and event the page uses (the list below), JSON in and out
  - `SessionFile` — open/save `.setline` files through native file dialogs

## The bridge (JS ⇄ native)

Native functions, called from JS, return JSON:
- `getAudioSetup()` → drivers, devices per driver, rates, buffer sizes, output channel names,
  the current choice
- `setAudioSetup({driver, device, rate, buffer})` → applies it and returns the new state or an error
- `getMidiOutputs()`
- `loadSong(songJson)` → turns the Edit page's song model into a `SongDef` (see "Song mapping")
  and loads it into the engine; returns warnings
- `transport({cmd: "play" | "stop", fromBar, fromBeat})`
- `setTrackLevel({track, db, mute, solo})` (live, glitch-free)
- `openSession()`, `saveSession(json)`, `saveSessionAs(json)` → native dialogs, `.setline` files (JSON)

Events, native → JS:
- `transport` at ~30 Hz while playing: `{playing, sample, seconds, bar, beat}`, plus once on change
- `meters` at ~30 Hz: peak per device output
- `engineStats` at 1 Hz: xruns, disk underruns, MIDI sent/dropped/late max, CPU
- `audioSetupChanged` (device unplugged, driver reset)

Wire the Edit page to it:
- Play/Stop button, Space bar, the song folder play buttons and `locate()` call `transport`
  instead of the JS timer. The playhead, LCD (bar.beat, time, BPM, meter, song/section) and
  meters follow the `transport` and `meters` events.
- The status chip in the top bar shows the real device, rate and buffer; its tooltip shows the stats.
- The Outputs page lists the real drivers, devices and output names, and changing them calls
  `setAudioSetup`. Track → output routing in the UI stays as designed (outputs numbered from 1).
- Mixer faders and M/S call `setTrackLevel`.
- Ctrl/⌘+S and Ctrl/⌘+O save and open sessions. The window title shows the session name and an
  unsaved marker.
- Keep the mockup's in-browser behaviour as a fallback when `window.__JUCE__` is missing,
  so the pages still open in a normal browser for design work.

## Engine additions (in `core/`, each with self-test checks)

1. **Start from any position**: `start(int64 fromSample)` seeks every stem, skips click and MIDI
   events before that point, and starts sample-exact. Check: starting at bar 9 puts the marker,
   click and MIDI on the same samples as when playing from bar 1.
2. **Explicit click hits**: the click is something the user enters (click clips in the Edit page),
   not automatic. `SongDef` gets a list of click hits `{bar, beat (fractional), accent}`; when
   it's provided, the engine plays exactly those and generates nothing else. Keep the current
   every-beat click only for the test song and the spike.
3. **Live track level**: per-stem gain in dB and mute, set from the message thread through
   atomics, ramped over ~10 ms inside the callback so faders don't click. The click and cue tracks
   get the same control.
4. **Output meters**: peak per output, written by the audio thread into atomics and read by the UI.
5. **Songs without stems** play (click, MIDI) for as long as their tempo map and content say.

## Song mapping (Edit page model → SongDef)

The Edit page model (see `ser()`, `buildBars`, and the data shapes in `1-arrange.html`):
- `tmap` `[{bar, bpm, sig, ramp}]` → `tempo` (ramps still play as jumps; say so in the warnings)
- `ck` click clips `[{bar, bars, notes:[{b, st, acc}]}]`, 16th steps per bar = `sig[0]*16/sig[1]`
  → click hits (bar = clip bar + b, beat = 1 + st / (16 / sig[1]))
- MIDI regions + events of the alternate in use (`s.malts`, `s.muse`) → `midi` events, port by name
- `clips` audio clips (seconds) → stems, once files exist (step 2). In step 1 a song may have no
  audio: play click and MIDI only.
- Track → output routing from the Outputs page settings.
- Use the song's selected version (`s.ver`).

## Phases (commit after each)

1. GUI app target that opens a native window showing the copied `1-arrange.html`, built with
   CMake + Ninja on this PC. Release build serves embedded files; `--dev` uses Vite.
2. AudioHost + `getAudioSetup` / `setAudioSetup`; Outputs page shows real devices
   (expect the Audient iD14 on ASIO with 6 outputs when built with
   `-DSETLINE_ASIO_SDK_DIR="C:/SDKs/asiosdk"`). Settings persist between launches.
3. Engine additions 1–5 with self-test checks.
4. `loadSong` + `transport` + events; the Edit page's Play/Stop/playhead/LCD/meters run on the
   engine. Play one of the example songs and hear its click through the interface.
5. `setTrackLevel`, session open/save, status chip, shortcuts, window title.
6. CI: build the GUI app on Windows and macOS (`.app` bundle zipped with `ditto`), keep the
   existing jobs, upload both.

## Done when

- The `setline` app launches on this PC and shows the Edit page with all its features working.
- Pressing Play on an example song plays its click (from its click clips) through the iD14 over
  ASIO from the playhead position, and the playhead, LCD and meters follow the engine.
- Stopping, playing from another bar, and switching songs work with no clicks or glitches.
- Faders and mutes change the click level live.
- Sessions save and reopen identically.
- `setline-core-test`, `setline-spike --selftest` and CI pass on both platforms.

## Don't (ask first)

- Change the look or layout of the mockups (beyond wiring them up).
- Add resampling or time-stretching anywhere. Stems must match the device rate.
- Break the real-time rules in `process()`.
- Rewrite the mockups into a framework. That's planned for later; step 1 wires up the existing pages.
- Commit the ASIO SDK, WebView2 binaries, or test audio.
