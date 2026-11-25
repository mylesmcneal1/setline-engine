#include "Log.h"
#include <memory>
#include <mutex>
#if JUCE_WINDOWS
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #include <windows.h>
#elif JUCE_MAC
 #include <sys/sysctl.h>
 #include <sys/time.h>
 #include <unistd.h>
#endif

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

// ---------------------------------------------------------------- 7a: start-up timing
namespace setline::gui::applog {
namespace {
std::mutex markLock;
juce::StringArray marks;
double procStartEpochMs()
{
    static const double v = [] {
       #if JUCE_WINDOWS
        FILETIME c, e, k, u;
        if (GetProcessTimes(GetCurrentProcess(), &c, &e, &k, &u)) {
            ULARGE_INTEGER t; t.LowPart = c.dwLowDateTime; t.HighPart = c.dwHighDateTime;
            return (double) (t.QuadPart / 10000ULL) - 11644473600000.0; // 100 ns since 1601 -> ms since 1970
        }
       #elif JUCE_MAC
        int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, (int) getpid() };
        struct kinfo_proc kp; size_t len = sizeof kp;
        if (sysctl(mib, 4, &kp, &len, nullptr, 0) == 0)
            return kp.kp_proc.p_starttime.tv_sec * 1000.0 + kp.kp_proc.p_starttime.tv_usec / 1000.0;
       #endif
        return (double) juce::Time::currentTimeMillis();
    }();
    return v;
}
} // namespace

double sinceProcessStartMs() { return (double) juce::Time::currentTimeMillis() - procStartEpochMs(); }

void mark(const juce::String& what, double tookMs)
{
    const double at = sinceProcessStartMs();
    const juce::String txt = what + " at " + (at >= 1000 ? juce::String(at / 1000.0, 2) + " s" : juce::String((int) at) + " ms")
                           + (tookMs >= 0 ? " (took " + juce::String((int) tookMs) + " ms)" : juce::String());
    { std::lock_guard<std::mutex> g(markLock); marks.add(txt); }
    line("Startup: " + txt);
}

juce::String startupSummary()
{
    std::lock_guard<std::mutex> g(markLock);
    return marks.isEmpty() ? juce::String("not measured") : marks.joinIntoString("; ");
}
} // namespace setline::gui::applog
