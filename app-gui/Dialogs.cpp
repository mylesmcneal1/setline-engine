#include "Dialogs.h"
#include "Log.h"
#include <map>

namespace setline::gui::dialogs {

namespace {
std::map<juce::String, std::unique_ptr<juce::FileChooser>>& choosers() { static std::map<juce::String, std::unique_ptr<juce::FileChooser>> m; return m; }
juce::String describe(const juce::FileChooser& fc)
{
    const auto all = fc.getResults();
    if (all.isEmpty()) return "cancelled";
    return all.size() == 1 ? all[0].getFullPathName() : juce::String(all.size()) + " files, first " + all[0].getFullPathName();
}
} // namespace

bool open(const juce::String& feature, std::unique_ptr<juce::FileChooser> chooser, int flags, std::function<void(const juce::FileChooser&)> then)
{
    auto& m = choosers();
    if (! m.empty()) {
        applog::line("File dialog \"" + feature + "\": refused, \"" + m.begin()->first + "\" is still open");
        then(*chooser); // never shown: no results, so the caller answers "cancelled"
        return false;
    }
    applog::line("File dialog \"" + feature + "\": requested");
    m[feature] = std::move(chooser);
    juce::MessageManager::callAsync([feature, flags, then = std::move(then)]() mutable {
        auto it = choosers().find(feature); if (it == choosers().end()) return;
        // in front of set.Line's window, never behind it
        juce::Process::makeForegroundProcess();
        for (int i = 0; i < juce::TopLevelWindow::getNumTopLevelWindows(); ++i)
            if (auto* w = juce::TopLevelWindow::getTopLevelWindow(i); w != nullptr && w->isVisible() && w->isOnDesktop()) { w->toFront(true); break; }
        applog::line("File dialog \"" + feature + "\": opened");
        it->second->launchAsync(flags, [feature, then](const juce::FileChooser& fc) {
            applog::line("File dialog \"" + feature + "\": " + describe(fc));
            then(fc);
            // the chooser goes once its callback has returned
            juce::MessageManager::callAsync([feature] { choosers().erase(feature); });
        });
    });
    return true;
}

juce::String current() { return choosers().empty() ? juce::String() : choosers().begin()->first; }

void closeAll() { choosers().clear(); }

} // namespace setline::gui::dialogs
