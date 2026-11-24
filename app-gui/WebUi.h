// set.Line desktop app: the web view that shows the UI pages from ui/.
// Release builds serve ui/dist from a zip embedded in the binary; --dev loads the Vite dev server.
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>

namespace setline::gui {

class WebUi : public juce::Component, public juce::FileDragAndDropTarget {
public:
    using Options = juce::WebBrowserComponent::Options;

    static constexpr const char* devServer = "http://localhost:5173/";
    static constexpr const char* startPage = "1-arrange.html";

    // configure: adds native functions / event listeners (the Bridge) to the browser options.
    WebUi(bool devMode, const std::function<Options(Options)>& configure);

    void loadStartPage(const juce::String& page = {});
    juce::WebBrowserComponent& browser() { return *web; }
    bool isDevMode() const { return dev; }

    void resized() override { web->setBounds(getLocalBounds()); }

    // Files dragged onto the window: the web view gives the page no paths, so the window takes the drop
    // (WebView2's own drop handling is off, see cmake/PatchJuce.cmake; on macOS the WKWebView stops
    // accepting file drags, see MacDrop.mm) and reports it here.
    std::function<void(const juce::String& state, juce::Point<int> at, const juce::StringArray& files)> onFileDrag;
    bool isInterestedInFileDrag(const juce::StringArray&) override { return true; }
    void fileDragEnter(const juce::StringArray& f, int x, int y) override { if (onFileDrag) onFileDrag("over", { x, y }, f); }
    void fileDragMove(const juce::StringArray& f, int x, int y) override { if (onFileDrag) onFileDrag("over", { x, y }, f); }
    void fileDragExit(const juce::StringArray&) override { if (onFileDrag) onFileDrag("leave", {}, {}); }
    void filesDropped(const juce::StringArray& f, int x, int y) override { if (onFileDrag) onFileDrag("drop", { x, y }, f); }

private:
    struct Browser : juce::WebBrowserComponent {
        Browser(const Options& o, WebUi& u) : juce::WebBrowserComponent(o), owner(u) {}
        bool pageAboutToLoad(const juce::String& url) override;
        void pageFinishedLoading(const juce::String&) override;
        WebUi& owner;
    };

    static std::optional<juce::WebBrowserComponent::Resource> serve(const juce::String& path);

    bool dev;
    std::unique_ptr<Browser> web;
};

} // namespace setline::gui
