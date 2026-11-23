// set.Line desktop app: every native function and event the web UI uses.
// Functions take one JSON string and complete with one JSON string (see ui/src/bridge.ts).
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>

namespace setline::gui {

class AudioHost;

class Bridge {
public:
    using Options = juce::WebBrowserComponent::Options;

    explicit Bridge(AudioHost& host);
    ~Bridge();

    Options addTo(Options o);
    void attach(juce::WebBrowserComponent* b) { browser = b; }
    void emit(const juce::Identifier& event, const juce::var& payload);

    bool devMode = false;

private:
    using Fn = std::function<juce::var(const juce::var&)>;
    static Options add(Options o, const char* name, Fn fn);

    AudioHost& audio;
    juce::WebBrowserComponent* browser = nullptr;
};

} // namespace setline::gui
