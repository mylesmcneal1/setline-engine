// set.Line desktop app (9e): every native file / folder dialog goes through here.
// - One at a time: while a set.Line dialog is open, another request is refused (the caller answers "cancelled") so
//   a second click can't replace, and close, the dialog that's still opening.
// - Each feature has its own chooser object, kept here until its dialog has answered.
// - The dialog opens on the message thread after the current event has finished (a menu that is still closing on
//   the Mac), with set.Line brought to the front first so the dialog can't open behind the window.
// - Each step goes to the app log: requested -> opened -> the result (or refused).
#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <functional>
#include <memory>

namespace setline::gui::dialogs {

// false: refused (another dialog is open); `then` is called at once with no results (= cancelled).
bool open(const juce::String& feature, std::unique_ptr<juce::FileChooser> chooser, int flags,
          std::function<void(const juce::FileChooser&)> then);
// the feature whose dialog is open ('' = none)
juce::String current();
// at quit: forget any dialog still open
void closeAll();

} // namespace setline::gui::dialogs
