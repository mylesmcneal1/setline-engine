// Builds without JUCE. Runs the engine self-test, then round-trips a generated test song
// through real WAV files to make sure what is written to disk plays back sample-exact too.
#include "../core/Engine.h"
#include "../core/Platform.h"
#include "../core/TestSong.h"
#include "../core/Wav.h"
#include <cstdio>
#include <filesystem>

int main()
{
    using namespace setline;
    std::setvbuf(stdout, nullptr, _IONBF, 0); // every line out, even if a check crashes
    platform::enableHighResolutionTimers();
    bool ok = runSelfTest(true);

    namespace fs = std::filesystem;
    const std::string dir = (fs::temp_directory_path() / "setline-core-test-song").string();
    const std::string err = writeTestSong(dir, 2, 20, 48000);
    std::printf("\nWAV round trip (%s)\n", dir.c_str());
    if (! err.empty()) { std::printf("  [FAIL] %s\n", err.c_str()); return 1; }

    std::string e2;
    auto marker = WavSource::load((fs::path(dir) / "00 Marker.wav").string(), e2);
    if (! marker) { std::printf("  [FAIL] %s\n", e2.c_str()); return 1; }
    TempoMap tm; tm.build(testTempo(), 48000, marker->length(), 17);
    int good = 0, total = 0;
    for (int b = 1; b <= tm.numBars(); ++b) {
        const int64_t s = tm.sampleAt(b, 1);
        if (s + 100 >= marker->length()) break;
        ++total;
        const float before = s > 0 ? marker->data[0][(size_t) s - 1] : 0.0f, at = marker->data[0][(size_t) s];
        if (before == 0.0f && at > 0.5f) ++good;
    }
    const bool rt = total > 5 && good == total;
    std::printf("  [%s] marker WAV has its edge on every downbeat sample (%d/%d)\n", rt ? "ok" : "FAIL", good, total);
    ok = ok && rt;
    std::printf(ok ? "\nCORE TEST PASSED\n" : "\nCORE TEST FAILED\n");
    return ok ? 0 : 1;
}
