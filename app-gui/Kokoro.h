// set.Line desktop app: built-in Kokoro voices for spoken cues (step 2, phase 7).
//
// - Kokoro-82M v1.0 (Apache-2.0) as ONNX, run with ONNX Runtime (Ort.h). All 28 English voices,
//   American and British, female and male.
// - Text to phonemes: misaki's English dictionaries (Apache-2.0) plus a small music word list (bass,
//   pre-chorus...), numbers and ordinals in code, and the show's own pronunciations. No espeak (GPL):
//   a word nobody knows is sounded out from its spelling and reported, so the user can add how it sounds.
// - The model, voices and dictionaries are not in the app or in git. They're downloaded when the user
//   asks ("Download better voices", 353 MB) into the app's data folder, from pinned revisions, and each file's SHA-256 is checked.
// - Rendering is slow work for a background thread (the Cues worker); never during playback.
#pragma once
#include <juce_core/juce_core.h>
#include <functional>
#include <map>
#include <vector>
#include "Speech.h"

namespace setline::gui::kokoro {

constexpr const char* prefix = "kokoro:"; // voice ids: "kokoro:af_heart"

struct VoiceInfo {
    const char* code;  // "af_heart"
    const char* name;  // "Heart"
    const char* lang;  // "en-US" / "en-GB"
    char gender;       // 'F' / 'M'
    const char* grade; // the model card's overall grade ("A", "B-", "C+"...)
    int rank;          // grade as a number, higher = better
};
const std::vector<VoiceInfo>& voiceTable();
// The voices as speech::Voice (engine "kokoro"), best first.
std::vector<speech::Voice> voices();
bool isKokoro(const juce::String& voiceId);
const VoiceInfo* find(const juce::String& voiceId);
juce::String defaultVoiceId(); // "kokoro:af_heart"

// ---- The downloaded files
enum class State { missing, downloading, ready, failed };
struct Status { State state = State::missing; juce::int64 done = 0, total = 0; juce::String error; };
Status status();
// Starts the download in the background unless it's ready or already running. Only when the user asks
// ("Download better voices"): nothing downloads by itself.
void startDownload();
// Stops a running download; the files that finished stay, the state goes back to missing.
void cancelDownload();
// Tests: waits until ready (downloading if needed); false + error on failure or timeout.
bool waitReady(int timeoutMs, juce::String& error);
// Called (on any thread) whenever the status changes, and about 4 times a second while downloading.
void setListener(std::function<void(const Status&)> fn);
// The app's data folder for models (SETLINE_MODELS_DIR overrides it, for tests and CI).
juce::File folder();
juce::String stateName(State s);

// ---- Speaking
// The show's pronunciations: lowercase word -> how it sounds ("jent worth"), or phonemes between
// slashes ("/ʤˈɛntwɜɹθ/").
using Pronunciations = std::map<juce::String, juce::String>;
// Text -> Kokoro phonemes, British or American. unknown: words no dictionary knew (sounded out from spelling).
juce::String phonemes(const juce::String& text, bool british, const Pronunciations& pron, juce::StringArray* unknown = nullptr);
// Speaks text with a Kokoro voice into mono samples at 24 kHz. Blocks; call from one background thread.
bool render(const juce::String& text, const juce::String& voiceId, double speed, const Pronunciations& pron,
            std::vector<float>& out, double& rate, juce::String& error);
// Frees the model's memory (it's loaded again on the next render). Same thread as render.
void unload();
// For reports: seconds the last render took inside the model.
double lastRenderSeconds();
// For tests: how many times the model has run since start-up.
int renderCount();

} // namespace setline::gui::kokoro
