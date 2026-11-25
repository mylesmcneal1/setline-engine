// set.Line desktop app: the band server (phase 6g). Phones and tablets on the band's own network open
// http://<this computer>:<port>/ and get band.html, the band screens' web app, served from the app itself. One
// WebSocket per screen (/ws) carries everything after that.
//
// - HTTP + WebSocket on one port (CivetWeb, MIT: THIRD_PARTY.md), on CivetWeb's own threads. Nothing here touches
//   the audio thread: if the network or a device dies, the show goes on.
// - Each client has its own writer thread and a short queue: a device that stops reading (Wi-Fi gone) only ever
//   blocks its own thread; the newest state replaces queued old ones, so nothing piles up.
// - Clock sync: {"t":"ping","c":<client ms>} is answered right away on the network thread with the host's time
//   ({"t":"pong","c":..,"h":<host ms>}); host times are juce::Time::getMillisecondCounterHiRes().
// - Everything else a client sends goes to the page on the message thread (onMessage), which checks it against
//   that screen's layout before anything happens (a screen can only do what its buttons do).
// - The host is advertised as setline.local (mDNS: Bonjour on macOS, DnsServiceRegister on Windows 10+ when
//   available). A QR code with the real address is always shown too (Android is unreliable with .local).
#pragma once
#include <juce_events/juce_events.h>
#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>

struct mg_context;
struct mg_connection;

namespace setline::gui {

class BandServer {
public:
    BandServer();
    ~BandServer();

    // Starts listening on every interface. "" or why not (the port is taken, ...).
    juce::String start(int port);
    void stop();
    bool running() const { return ctx != nullptr; }
    int port() const { return listenPort; }
    // This computer's IPv4 addresses (not loopback), best first.
    static juce::StringArray addresses();
    // Whether setline.local is being advertised, and why not.
    juce::String mdnsState() const { return mdns; }

    // Any thread: one message to every client / to one. Messages starting with {"t":"state" replace a queued state.
    void broadcast(const juce::String& json);
    void sendTo(int client, const juce::String& json);
    void closeClient(int client);
    int clientCount() const;

    // Called on the message thread.
    std::function<void(int client, const juce::String& text)> onMessage;
    std::function<void(int client, bool connected, const juce::String& address)> onClient;
    // Serves a file of the web UI ("band.html", "assets/x.js"): bytes + mime type, or false.
    std::function<bool(const juce::String& path, juce::MemoryBlock& out, juce::String& mime)> serveFile;

    struct Client;
private:
    static int httpHandler(mg_connection* c, void* self);
    static int wsConnect(const mg_connection* c, void* self);
    static void wsReady(mg_connection* c, void* self);
    static int wsData(mg_connection* c, int bits, char* data, size_t len, void* self);
    static void wsClose(const mg_connection* c, void* self);
    void advertise();
    void unadvertise();

    mg_context* ctx = nullptr;
    int listenPort = 0;
    mutable std::mutex mx;
    std::map<const mg_connection*, std::shared_ptr<Client>> clients;
    std::atomic<int> nextId { 1 };
    std::shared_ptr<std::atomic<bool>> alive = std::make_shared<std::atomic<bool>>(true);
    juce::String mdns = "off";
    void* mdnsHandle = nullptr;
};

} // namespace setline::gui
