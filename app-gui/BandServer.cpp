#include "BandServer.h"
#include "Log.h"
#include <civetweb.h>
#include <condition_variable>
#include <deque>
#include <thread>

#if JUCE_WINDOWS
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #include <windows.h>
#elif JUCE_MAC
 #include <dns_sd.h>
 #include <arpa/inet.h>
#endif

namespace setline::gui {

struct BandServer::Client {
    int id = 0;
    mg_connection* conn = nullptr;
    juce::String address;
    std::mutex wmx;                 // held while writing to the connection (the close waits for it)
    std::mutex qmx;
    std::condition_variable cv;
    std::deque<std::string> q;      // waiting to be sent
    std::atomic<bool> closed { false };
};

namespace {
std::once_flag civetInit;
double hostNow() { return juce::Time::getMillisecondCounterHiRes(); }
juce::String& startError() { static juce::String e; return e; } // what CivetWeb said when it couldn't start
bool isState(const std::string& m) { return m.rfind("{\"t\":\"state\"", 0) == 0; }

void enqueue(BandServer::Client& c, const std::string& m)
{
    {
        std::lock_guard<std::mutex> g(c.qmx);
        if (c.closed) return;
        if (isState(m) && ! c.q.empty() && isState(c.q.back())) c.q.back() = m; // only the newest state matters
        else {
            if (c.q.size() >= 64) c.q.pop_front(); // a device that stopped reading: keep the newest
            c.q.push_back(m);
        }
    }
    c.cv.notify_one();
}

void writer(std::shared_ptr<BandServer::Client> c)
{
    for (;;) {
        std::string m;
        {
            std::unique_lock<std::mutex> l(c->qmx);
            c->cv.wait(l, [&] { return c->closed.load() || ! c->q.empty(); });
            if (c->closed) return;
            m = std::move(c->q.front());
            c->q.pop_front();
        }
        std::lock_guard<std::mutex> g(c->wmx);
        if (! c->closed && c->conn) mg_websocket_write(c->conn, MG_WEBSOCKET_OPCODE_TEXT, m.data(), m.size());
    }
}
} // namespace

BandServer::BandServer() { std::call_once(civetInit, [] { mg_init_library(0); }); }
BandServer::~BandServer() { alive->store(false); stop(); }

juce::StringArray BandServer::addresses()
{
    juce::StringArray best, rest;
    for (auto& a : juce::IPAddress::getAllAddresses(false)) {
        const auto s = a.toString();
        if (s.startsWith("127.") || s.startsWith("169.254.") || s == "0.0.0.0" || s.getIntValue() >= 224) continue; // not loopback, link-local or multicast
        (s.startsWith("192.168.") || s.startsWith("10.") || s.startsWith("172.") ? best : rest).addIfNotAlreadyThere(s);
    }
    best.addArray(rest);
    return best;
}

juce::String BandServer::start(int port)
{
    stop();
    if (port < 1 || port > 65535) return "Choose a port between 1 and 65535.";
    const auto ps = std::to_string(port);
    const char* opts[] = { "listening_ports", ps.c_str(), "num_threads", "24", "request_timeout_ms", "10000",
                           "websocket_timeout_ms", "3600000", "enable_keep_alive", "yes", nullptr };
    mg_callbacks cb {};
    cb.log_message = [](const mg_connection*, const char* msg) { startError() = juce::String::fromUTF8(msg); return 1; };
    startError() = juce::String();
    ctx = mg_start(&cb, this, opts);
    if (ctx == nullptr) {
        juce::String why = startError();
        if (why.containsIgnoreCase("bind") || why.containsIgnoreCase("in use") || why.containsIgnoreCase("port"))
            why = "Port " + juce::String(port) + " is already in use on this computer (" + why + "). Choose another port in Settings › Band.";
        applog::line("Band server: couldn't start: " + why);
        return why.isNotEmpty() ? why : "The band server couldn't start on port " + juce::String(port) + ".";
    }
    listenPort = port;
    mg_set_request_handler(ctx, "/", &BandServer::httpHandler, this);
    mg_set_websocket_handler(ctx, "/ws", &BandServer::wsConnect, &BandServer::wsReady, &BandServer::wsData, &BandServer::wsClose, this);
    applog::line("Band server: listening on port " + juce::String(port) + " (" + addresses().joinIntoString(", ") + ")");
    advertise();
    return {};
}

void BandServer::stop()
{
    if (ctx == nullptr) return;
    unadvertise();
    mg_stop(ctx); // closes every connection (their close handlers run)
    ctx = nullptr;
    std::lock_guard<std::mutex> g(mx);
    for (auto& [k, c] : clients) { c->closed = true; c->cv.notify_all(); }
    clients.clear();
    applog::line("Band server: stopped");
}

int BandServer::clientCount() const { std::lock_guard<std::mutex> g(mx); return (int) clients.size(); }

void BandServer::broadcast(const juce::String& json)
{
    const std::string m = json.toStdString();
    std::lock_guard<std::mutex> g(mx);
    for (auto& [k, c] : clients) enqueue(*c, m);
}

void BandServer::sendTo(int client, const juce::String& json)
{
    const std::string m = json.toStdString();
    std::lock_guard<std::mutex> g(mx);
    for (auto& [k, c] : clients) if (c->id == client) enqueue(*c, m);
}

void BandServer::closeClient(int client)
{
    std::lock_guard<std::mutex> g(mx);
    for (auto& [k, c] : clients)
        if (c->id == client) { std::lock_guard<std::mutex> w(c->wmx); if (c->conn) mg_websocket_write(c->conn, MG_WEBSOCKET_OPCODE_CONNECTION_CLOSE, "", 0); }
}

int BandServer::httpHandler(mg_connection* conn, void* self)
{
    auto* s = static_cast<BandServer*>(self);
    const auto* ri = mg_get_request_info(conn);
    juce::String path = juce::String::fromUTF8(ri->local_uri ? ri->local_uri : "/");
    path = juce::URL::removeEscapeChars(path).trimCharactersAtStart("/");
    if (path.isEmpty() || path == "band" || path == "join") path = "band.html";
    if (path.contains("..")) { mg_send_http_error(conn, 404, "%s", "Not found"); return 404; }
    juce::MemoryBlock body; juce::String mime;
    if (! s->serveFile || ! s->serveFile(path, body, mime)) { mg_send_http_error(conn, 404, "%s", "Not found"); return 404; }
    const bool html = path.endsWithIgnoreCase(".html");
    mg_printf(conn, "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %lld\r\nCache-Control: %s\r\nConnection: keep-alive\r\n\r\n",
              mime.toRawUTF8(), (long long) body.getSize(), html ? "no-cache" : "max-age=3600");
    mg_write(conn, body.getData(), body.getSize());
    return 200;
}

int BandServer::wsConnect(const mg_connection*, void*) { return 0; } // accept

void BandServer::wsReady(mg_connection* conn, void* self)
{
    auto* s = static_cast<BandServer*>(self);
    auto c = std::make_shared<Client>();
    c->id = s->nextId++;
    c->conn = conn;
    const auto* ri = mg_get_request_info(conn);
    c->address = juce::String(ri->remote_addr);
    { std::lock_guard<std::mutex> g(s->mx); s->clients[conn] = c; }
    std::thread(writer, c).detach();
    auto alive = s->alive; const int id = c->id; const auto addr = c->address;
    juce::MessageManager::callAsync([s, alive, id, addr] { if (*alive && s->onClient) s->onClient(id, true, addr); });
}

int BandServer::wsData(mg_connection* conn, int bits, char* data, size_t len, void* self)
{
    auto* s = static_cast<BandServer*>(self);
    const int op = bits & 0x0f;
    if (op == MG_WEBSOCKET_OPCODE_CONNECTION_CLOSE) return 0;
    if (op != MG_WEBSOCKET_OPCODE_TEXT) return 1;
    std::shared_ptr<Client> c;
    { std::lock_guard<std::mutex> g(s->mx); if (auto it = s->clients.find(conn); it != s->clients.end()) c = it->second; }
    if (! c) return 1;
    const juce::String text = juce::String::fromUTF8(data, (int) len);
    // clock sync: answered here, at once, with the host's time (the round trip stays as short as it can be)
    if (text.startsWith("{\"t\":\"ping\"")) {
        const auto v = juce::JSON::parse(text);
        const auto reply = "{\"t\":\"pong\",\"c\":" + juce::String((double) v["c"], 3) + ",\"h\":" + juce::String(hostNow(), 3) + "}";
        std::lock_guard<std::mutex> g(c->wmx);
        if (! c->closed) mg_websocket_write(conn, MG_WEBSOCKET_OPCODE_TEXT, reply.toRawUTF8(), (size_t) reply.getNumBytesAsUTF8());
        return 1;
    }
    auto alive = s->alive; const int id = c->id;
    juce::MessageManager::callAsync([s, alive, id, text] { if (*alive && s->onMessage) s->onMessage(id, text); });
    return 1;
}

void BandServer::wsClose(const mg_connection* conn, void* self)
{
    auto* s = static_cast<BandServer*>(self);
    std::shared_ptr<Client> c;
    {
        std::lock_guard<std::mutex> g(s->mx);
        if (auto it = s->clients.find(conn); it != s->clients.end()) { c = it->second; s->clients.erase(it); }
    }
    if (! c) return;
    c->closed = true;
    c->cv.notify_all();
    { std::lock_guard<std::mutex> w(c->wmx); c->conn = nullptr; } // no write after this
    auto alive = s->alive; const int id = c->id; const auto addr = c->address;
    juce::MessageManager::callAsync([s, alive, id, addr] { if (*alive && s->onClient) s->onClient(id, false, addr); });
}

// ---------------------------------------------------------------- mDNS: setline.local
#if JUCE_WINDOWS
namespace {
// windns.h's service registration (Windows 10 1809+), declared here and loaded at run time so set.Line still starts
// on older Windows (where there's simply no setline.local; the QR code still works).
struct SvcInstance { LPWSTR instanceName, hostName; DWORD* ip4; void* ip6; WORD port, priority, weight; DWORD propCount; PWSTR* keys; PWSTR* values; DWORD ifIndex; };
typedef void (WINAPI* RegComplete)(DWORD, PVOID, SvcInstance*);
struct SvcRegRequest { ULONG version; ULONG ifIndex; SvcInstance* instance; RegComplete done; PVOID ctx; HANDLE cred; BOOL unicast; };
struct SvcCancel { PVOID reserved; };
typedef SvcInstance* (WINAPI* ConstructFn)(PCWSTR, PCWSTR, DWORD*, void*, WORD, WORD, WORD, DWORD, PCWSTR*, PCWSTR*);
typedef DWORD (WINAPI* RegisterFn)(SvcRegRequest*, SvcCancel*);
typedef void (WINAPI* FreeFn)(SvcInstance*);
struct WinMdns { HMODULE dll = nullptr; SvcInstance* inst = nullptr; SvcRegRequest req {}; RegisterFn reg = nullptr, dereg = nullptr; FreeFn free = nullptr; };
void WINAPI regDone(DWORD status, PVOID, SvcInstance*) { applog::line("Band server: setline.local " + juce::String(status == 0 ? "advertised" : "not advertised (" + juce::String((int) status) + ")")); }
void WINAPI deregDone(DWORD, PVOID, SvcInstance*) {}
} // namespace
#elif JUCE_MAC
namespace {
struct MacMdns { DNSServiceRef svc = nullptr, conn = nullptr; DNSRecordRef rec = nullptr; };
void DNSSD_API recDone(DNSServiceRef, DNSRecordRef, DNSServiceFlags, DNSServiceErrorType, void*) {}
} // namespace
#endif

void BandServer::advertise()
{
    const auto ips = addresses();
    if (ips.isEmpty()) { mdns = "no network"; return; }
   #if JUCE_WINDOWS
    auto* m = new WinMdns();
    m->dll = LoadLibraryW(L"dnsapi.dll");
    auto construct = m->dll ? (ConstructFn) GetProcAddress(m->dll, "DnsServiceConstructInstance") : nullptr;
    m->reg = m->dll ? (RegisterFn) GetProcAddress(m->dll, "DnsServiceRegister") : nullptr;
    m->dereg = m->dll ? (RegisterFn) GetProcAddress(m->dll, "DnsServiceDeRegister") : nullptr;
    m->free = m->dll ? (FreeFn) GetProcAddress(m->dll, "DnsServiceFreeInstance") : nullptr;
    if (! construct || ! m->reg || ! m->dereg || ! m->free) { if (m->dll) FreeLibrary(m->dll); delete m; mdns = "not available on this Windows"; return; }
    DWORD ip4 = 0; // network byte order
    {
        const auto parts = juce::StringArray::fromTokens(ips[0], ".", "");
        ip4 = (DWORD) ((parts[3].getIntValue() & 255) << 24 | (parts[2].getIntValue() & 255) << 16 | (parts[1].getIntValue() & 255) << 8 | (parts[0].getIntValue() & 255));
    }
    m->inst = construct(L"set.Line._http._tcp.local", L"setline.local", &ip4, nullptr, (WORD) listenPort, 0, 0, 0, nullptr, nullptr);
    if (! m->inst) { FreeLibrary(m->dll); delete m; mdns = "couldn't be set up"; return; }
    m->req.version = 1; m->req.ifIndex = 0; m->req.instance = m->inst; m->req.done = regDone; m->req.ctx = nullptr; m->req.cred = nullptr; m->req.unicast = FALSE;
    const DWORD r = m->reg(&m->req, nullptr);
    if (r != 9506 /* DNS_REQUEST_PENDING */ && r != 0) { m->free(m->inst); FreeLibrary(m->dll); delete m; mdns = "refused (" + juce::String((int) r) + ")"; return; }
    mdnsHandle = m; mdns = "setline.local";
   #elif JUCE_MAC
    auto* m = new MacMdns();
    in_addr a {}; inet_pton(AF_INET, ips[0].toRawUTF8(), &a);
    DNSServiceErrorType e = DNSServiceCreateConnection(&m->conn);
    if (e == kDNSServiceErr_NoError)
        e = DNSServiceRegisterRecord(m->conn, &m->rec, kDNSServiceFlagsShared, 0, "setline.local.", kDNSServiceType_A, kDNSServiceClass_IN, 4, &a, 0, recDone, nullptr);
    if (e == kDNSServiceErr_NoError)
        e = DNSServiceRegister(&m->svc, 0, 0, "set.Line", "_http._tcp", nullptr, "setline.local.", htons((uint16_t) listenPort), 0, nullptr, nullptr, nullptr);
    if (e != kDNSServiceErr_NoError) {
        if (m->svc) DNSServiceRefDeallocate(m->svc);
        if (m->conn) DNSServiceRefDeallocate(m->conn);
        delete m; mdns = "Bonjour refused (" + juce::String((int) e) + ")"; return;
    }
    mdnsHandle = m; mdns = "setline.local";
   #else
    mdns = "not available";
   #endif
    applog::line("Band server: mDNS " + mdns);
}

void BandServer::unadvertise()
{
    if (mdnsHandle == nullptr) return;
   #if JUCE_WINDOWS
    auto* m = static_cast<WinMdns*>(mdnsHandle);
    m->req.done = deregDone;
    m->dereg(&m->req, nullptr);
    // the instance is freed after a moment (the deregistration completes asynchronously)
    auto* inst = m->inst; auto fr = m->free;
    juce::Timer::callAfterDelay(2000, [inst, fr] { fr(inst); });
    delete m;
   #elif JUCE_MAC
    auto* m = static_cast<MacMdns*>(mdnsHandle);
    if (m->svc) DNSServiceRefDeallocate(m->svc);
    if (m->conn) DNSServiceRefDeallocate(m->conn);
    delete m;
   #endif
    mdnsHandle = nullptr; mdns = "off";
}

} // namespace setline::gui
