#include "WebUi.h"
#include <mutex>
#include "Folders.h"
#include <SetLineUi.h>
#include <unordered_map>

namespace setline::gui {

#if JUCE_MAC
void stopWebViewFileDrops(juce::Component& browser); // MacDrop.mm
void setlineInstallPinch(juce::WebBrowserComponent& browser); // MacDrop.mm (12)
#endif

namespace {

// ui/dist, zipped at build time (cmake/BuildUi.cmake) and embedded with juce_add_binary_data.
juce::ZipFile* uiArchive()
{
    static juce::MemoryInputStream stream(SetLineUi::setlineui_zip, (size_t) SetLineUi::setlineui_zipSize, false);
    static juce::ZipFile zip(stream);
    return zip.getNumEntries() > 0 ? &zip : nullptr;
}

juce::String mimeFor(const juce::String& file)
{
    static const std::unordered_map<juce::String, const char*> types {
        { "html", "text/html" }, { "htm", "text/html" }, { "js", "text/javascript" }, { "mjs", "text/javascript" },
        { "css", "text/css" }, { "json", "application/json" }, { "map", "application/json" }, { "svg", "image/svg+xml" },
        { "png", "image/png" }, { "jpg", "image/jpeg" }, { "jpeg", "image/jpeg" }, { "ico", "image/vnd.microsoft.icon" },
        { "woff", "font/woff" }, { "woff2", "font/woff2" }, { "ttf", "font/ttf" }, { "wav", "audio/wav" }, { "txt", "text/plain" },
    };
    const auto ext = file.fromLastOccurrenceOf(".", false, false).toLowerCase();
    if (auto it = types.find(ext); it != types.end()) return it->second;
    return "application/octet-stream";
}

} // namespace

WebUi::WebUi(bool devMode, const std::function<Options(Options)>& configure) : dev(devMode)
{
    // the page's own data (localStorage) with the caches (Folders.h); SETLINE_WEBVIEW_DATA: another folder (tests)
    const auto env = juce::SystemStats::getEnvironmentVariable("SETLINE_WEBVIEW_DATA", {});
    const auto dataDir = env.isNotEmpty() ? juce::File(env) : folders::webViewData();
    dataDir.createDirectory();

    Options o = Options {}
        .withBackend(Options::Backend::webview2)
        .withWinWebView2Options(Options::WinWebView2 {}
                                    .withUserDataFolder(dataDir)
                                    .withStatusBarDisabled()
                                    .withBackgroundColour(juce::Colour(0xff0b0c0e)))
        .withNativeIntegrationEnabled()
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withResourceProvider([](const juce::String& path) { return serve(path); });
    if (configure) o = configure(o);

    web = std::make_unique<Browser>(o, *this);
    addAndMakeVisible(*web);
}

void WebUi::loadStartPage(const juce::String& pageIn)
{
    const juce::String page = pageIn.isNotEmpty() ? pageIn : juce::String(startPage);
    web->goToURL(dev ? juce::String(devServer) + page
                     : juce::WebBrowserComponent::getResourceProviderRoot() + page);
}

std::optional<juce::WebBrowserComponent::Resource> WebUi::serve(const juce::String& rawPath)
{
    // "/" -> start page; strip the query ("1-arrange.html?settings=audio") and fragment.
    auto path = rawPath.upToFirstOccurrenceOf("?", false, false).upToFirstOccurrenceOf("#", false, false);
    path = juce::URL::removeEscapeChars(path).trimCharactersAtStart("/");
    if (path.isEmpty()) path = startPage;

    // the window and the band server (6g, its own threads) both read the archive: one at a time
    static std::mutex zipLock;
    std::lock_guard<std::mutex> g(zipLock);
    auto* zip = uiArchive();
    if (zip == nullptr) return std::nullopt;
    const auto* entry = zip->getEntry(path);
    if (entry == nullptr) entry = zip->getEntry("./" + path);
    if (entry == nullptr) return std::nullopt;

    std::unique_ptr<juce::InputStream> in(zip->createStreamForEntry(*entry));
    if (! in) return std::nullopt;
    juce::MemoryBlock block;
    in->readIntoMemoryBlock(block);
    std::vector<std::byte> bytes(block.getSize());
    if (block.getSize() > 0) std::memcpy(bytes.data(), block.getData(), block.getSize());
    return juce::WebBrowserComponent::Resource { std::move(bytes), mimeFor(path) };
}

void WebUi::Browser::pageFinishedLoading(const juce::String&)
{
   #if JUCE_MAC
    stopWebViewFileDrops(*this);
    setlineInstallPinch(*this);
   #endif
}

bool WebUi::Browser::pageAboutToLoad(const juce::String& url)
{
    // Our own pages (embedded, or the dev server in --dev) load in the window; anything else
    // (a link to a website) opens in the system browser so native integration never reaches it.
    const auto root = juce::WebBrowserComponent::getResourceProviderRoot();
    if (url.startsWith(root) || url == root.trimCharactersAtEnd("/")) return true;
    if (owner.dev && url.startsWith(devServer)) return true;
    if (url.startsWith("about:") || url.startsWith("data:")) return true;
    if (url.startsWith("http://") || url.startsWith("https://")) juce::URL(url).launchInDefaultBrowser();
    return false;
}

} // namespace setline::gui
