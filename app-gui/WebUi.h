// set.Line desktop app: the web view that shows the UI pages from ui/.
// Release builds serve ui/dist from a zip embedded in the binary; --dev loads the Vite dev server.
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>

namespace setline::gui {

class WebUi : public juce::Component {
public:
    using Options = juce::WebBrowserComponent::Options;

    static constexpr const char* devServer = "http://localhost:5173/";
    static constexpr const char* startPage = "1-arrange.html";

    // configure: adds native functions / event listeners (the Bridge) to the browser options.
    WebUi(bool devMode, const std::function<Options(Options)>& configure);

    void loadStartPage();
    juce::WebBrowserComponent& browser() { return *web; }
    bool isDevMode() const { return dev; }

    void resized() override { web->setBounds(getLocalBounds()); }

private:
    struct Browser : juce::WebBrowserComponent {
        Browser(const Options& o, WebUi& u) : juce::WebBrowserComponent(o), owner(u) {}
        bool pageAboutToLoad(const juce::String& url) override;
        WebUi& owner;
    };

    static std::optional<juce::WebBrowserComponent::Resource> serve(const juce::String& path);

    bool dev;
    std::unique_ptr<Browser> web;
};

} // namespace setline::gui
