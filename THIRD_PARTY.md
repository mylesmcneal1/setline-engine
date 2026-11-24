# Third-party software and data in set.Line

set.Line is closed-source. Everything below is either compiled in, shipped next to the app, or downloaded
by the app. Each entry gives the licence and where the exact version is pinned.

## Shipped with the app or compiled in

| What | Version | Licence | Where it's pinned |
| --- | --- | --- | --- |
| JUCE (window, audio devices, files) | 8.0.14 | AGPLv3 **or** a JUCE commercial licence (the free Starter tier exists) | `CMakeLists.txt` (`SETLINE_JUCE_TAG`) |
| ONNX Runtime (runs the Kokoro voice model) | **1.19.2** | MIT. Its own notices ship as `licenses/onnxruntime-ThirdPartyNotices.txt` | `cmake/OnnxRuntime.cmake` (NuGet package, SHA-512 checked) |
| Microsoft WebView2 SDK (Windows) | 1.0.3485.44 | Microsoft's BSD-style WebView2 SDK licence | `.github/workflows/build.yml`, `docs/building-the-app.md` |
| Steinberg ASIO SDK (Windows, optional) | user-supplied | Steinberg proprietary licence or GPLv3 (see README "Shipping note") | not in git |
| Inter, JetBrains Mono fonts (web UI) | see `ui/package.json` | SIL Open Font License 1.1 | `ui/package-lock.json` |

Before the first public release, two licences still need a decision: JUCE (closed source needs a JUCE
licence) and ASIO (see the README).

## Downloaded by the app on first use (Kokoro cue voices)

These are not in git or in the app. On first use the app downloads them into its data folder:
- Windows: `%LOCALAPPDATA%\set.Line\Models`
- macOS: `~/Library/Application Support/set.Line/Models`

Each file's SHA-256 is checked before it's used. The URLs, sizes and hashes are in `app-gui/Kokoro.cpp`.

| What | Revision | Licence |
| --- | --- | --- |
| Kokoro-82M v1.0 (hexgrad), ONNX conversion by onnx-community: `onnx/model.onnx` (fp32, 326 MB) | `onnx-community/Kokoro-82M-v1.0-ONNX` @ `1939ad2a` | Apache-2.0 |
| Kokoro v1.0 voices: the 28 English voices (`voices/af_*, am_*, bf_*, bm_*.bin`, 0.5 MB each) | same | Apache-2.0 |
| misaki English dictionaries (`us_gold`, `us_silver`, `gb_gold`, `gb_silver`.json) | `hexgrad/misaki` @ `fba12365` | Apache-2.0 (the repository's licence; it gives no separate licence for the data) |

The text-to-phoneme code in `app-gui/Kokoro.cpp` follows misaki's rules (Apache-2.0): dictionary lookup,
the -s/-ed/-ing endings, and spelling out acronyms (BVS). It is a C++ rewrite, not misaki's code.

No GPL code or data is used for speech. In particular there is no espeak-ng: a word the dictionaries
don't know is sounded out from its spelling (simple English rules in our code) and listed on the Cue
voice panel, so the user can add a pronunciation.

## Why ONNX Runtime stays on 1.19.2

The 2015 MacBook Pro this has to run on is an **Intel** Mac that stops at **macOS 12**. Here is the
oldest macOS each version's macOS library is built for (read from the libraries themselves):

| ONNX Runtime | Intel Mac build | Oldest macOS | Runs Kokoro v1.0 (opset 20) |
| --- | --- | --- | --- |
| 1.24 and later | none (Apple Silicon only) | 14.0 | yes |
| 1.20 - 1.23 | yes | 13.3 / 13.4 | yes |
| **1.17 - 1.19** | yes | **11.0** | yes |
| 1.16 | yes | 10.14 | no (too old for opset 20) |

1.19.2 is the newest release that still runs on that Mac. Don't upgrade it unless one of these happens:
- set.Line no longer needs to support Intel Macs on macOS 12, or
- we build ONNX Runtime ourselves for that target.

Even on a computer where ONNX Runtime can't load (e.g. macOS 10.15), set.Line still opens and plays
shows, because the library is only loaded when a voice is rendered. Cues then use the computer's
voices, or a show's stored cue audio (phase 7, part 3).
