#include "Log.h"
#include <memory>
#include <mutex>

namespace setline::gui::applog {

namespace {
std::unique_ptr<juce::FileLogger> logger;
juce::File file;
std::mutex lock;
} // namespace

juce::File folder()
{
   #if JUCE_MAC
    return juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Library/Logs/set.Line");
   #elif JUCE_WINDOWS
    return juce::File::getSpecialLocation(juce::File::windowsLocalAppData).getChildFile("set.Line/Logs");
   #else
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("set.Line/Logs");
   #endif
}

juce::File current() { std::lock_guard<std::mutex> g(lock); return file; }

void start(const juce::String& version)
{
    std::lock_guard<std::mutex> g(lock);
    if (logger) return;
    auto dir = folder();
    dir.createDirectory();
    // keep the last 20 runs
    auto old = dir.findChildFiles(juce::File::findFiles, false, "setline-*.log");
    old.sort();
    for (int i = 0; i < old.size() - 19; ++i) old.getReference(i).deleteFile();
    file = dir.getChildFile("setline-" + juce::Time::getCurrentTime().formatted("%Y-%m-%d_%H-%M-%S") + ".log").getNonexistentSibling();
    logger = std::make_unique<juce::FileLogger>(file, "set.Line " + version + " · " + juce::SystemStats::getOperatingSystemName(), 0);
    juce::Logger::setCurrentLogger(logger.get());
}

void stop()
{
    std::lock_guard<std::mutex> g(lock);
    if (! logger) return;
    juce::Logger::setCurrentLogger(nullptr);
    logger.reset();
}

void line(const juce::String& text)
{
    const auto now = juce::Time::getCurrentTime();
    juce::Logger::writeToLog(now.formatted("%H:%M:%S.") + juce::String(now.getMilliseconds()).paddedLeft('0', 3) + "  " + text);
}

juce::String tail(int n)
{
    juce::StringArray lines;
    lines.addLines(current().loadFileAsString());
    lines.removeEmptyStrings();
    const int from = juce::jmax(0, lines.size() - n);
    juce::StringArray last;
    for (int i = from; i < lines.size(); ++i) last.add(lines[i]);
    return last.joinIntoString("\n");
}

} // namespace setline::gui::applog
