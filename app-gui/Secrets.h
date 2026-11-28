#pragma once
// 15 §13: secrets kept by the operating system, never in set.Line's settings, the library or the logs: the macOS
// Keychain (a generic password, service "set.Line") and the Windows Credential Manager (a generic credential
// "set.Line/<name>"). Elsewhere (Linux builds): not stored (get returns "").
#include <juce_core/juce_core.h>

namespace setline::gui::secrets {

juce::String get(const juce::String& name);
bool set(const juce::String& name, const juce::String& value); // "" removes it
bool remove(const juce::String& name);

} // namespace setline::gui::secrets
