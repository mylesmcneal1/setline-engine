// set.Line desktop app: ONNX Runtime, loaded at run time (step 2, phase 7: Kokoro cue voices).
//
// The library ships next to the app (cmake/OnnxRuntime.cmake, pinned to 1.19.2 so Intel Macs on macOS 12
// keep working) and is loaded by its full path the first time a voice is rendered, never at start-up:
// the app opens and plays shows (with their stored cues) even where it can't load. Windows has its own,
// older onnxruntime.dll in System32; loading by full path makes sure ours is the one used.
#pragma once
#include <juce_core/juce_core.h>

struct OrtApi;

namespace setline::gui::ort {

// The ONNX Runtime C API, or nullptr with a reason. Loads the library on the first call; thread-safe.
const OrtApi* api(juce::String& error);
// Where the library is expected (next to the app / in the app's Frameworks folder).
juce::File libraryFile();
// "1.19.2" once loaded (the library's own report), else "".
juce::String loadedVersion();

} // namespace setline::gui::ort
