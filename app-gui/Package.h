// set.Line desktop app: .setline packages (phase 6f): how a setlist moves to another computer, a backup rig or a
// bandmate. A package is a plain zip: setline.json (the setlist, every song it uses with all their versions, the
// song fields, dashboards, patch name lists...), Audio/<hash>.<ext> (only the audio those songs use) and Cues/ (the
// rendered cues, so they sound the same anywhere). Entries are stored, not compressed (audio doesn't shrink), with
// Zip64 so a big set is fine; any unzip tool opens it.
// Writing runs on its own thread with progress and Cancel; reading is quick (the directory only), extracting copies
// the entries asked for.
#pragma once
#include <juce_core/juce_core.h>
#include <atomic>
#include <functional>
#include <memory>
#include <thread>
#include <vector>

namespace setline::gui {

namespace package {

struct Entry { juce::String name; juce::File source; juce::String text; }; // a file to copy, or text
struct ZipItem { juce::String name; int64_t offset = 0, size = 0; uint32_t crc = 0; uint16_t method = 0; };

// Writes the zip to `to` (via "<to>.part", renamed when complete). progress(done, total, current name) is called on
// the writing thread; cancel stops it (the part file is removed). Returns "" or why not.
juce::String write(const juce::File& to, const std::vector<Entry>& entries, std::atomic<bool>& cancel,
                   const std::function<void(int64_t, int64_t, const juce::String&)>& progress);
// The zip's directory. "" or why not.
juce::String list(const juce::File& zip, std::vector<ZipItem>& items);
// One entry's bytes into a file (via a temp file), or as text.
bool extract(const juce::File& zip, const ZipItem& item, const juce::File& to);
juce::String readText(const juce::File& zip, const ZipItem& item);

} // namespace package

} // namespace setline::gui
