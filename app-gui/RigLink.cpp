#include "RigLink.h"
#include "Log.h"

namespace setline::gui {

namespace {
juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> kv)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : kv) o->setProperty(k, v);
    return juce::var(o);
}
juce::StringArray localIPs()
{
    juce::StringArray out;
    for (auto& a : juce::IPAddress::getAllAddresses(false)) { const auto s = a.toString(); const int first = s.upToFirstOccurrenceOf(".", false, false).getIntValue(); if (s != "127.0.0.1" && ! s.startsWith("169.254.") && (first < 224 || first > 239)) out.addIfNotAlreadyThere(s); }
    return out;
}
bool readLine(juce::StreamingSocket& s, juce::String& line)
{
    line.clear(); char c = 0;
    for (int n = 0; n < 200; ++n) { if (s.read(&c, 1, true) != 1) return false; if (c == '\n') return true; line += c; }
    return false;
}
} // namespace

RigLink::RigLink(juce::PropertiesFile& s) : settings(s)
{
    roleName = settings.getValue("rigRole", "off");
    peer = settings.getValue("rigPeer");
    code = settings.getValue("rigCode");
    if (code.length() != 4) { code = juce::String(1000 + juce::Random::getSystemRandom().nextInt(9000)); settings.setValue("rigCode", code); }
    latency.store(juce::jlimit(20, 100, settings.getIntValue("rigLatencyMs", 50)));
    hb.timeoutMs = juce::jlimit(200, 5000, settings.getIntValue("rigTimeoutMs", 500));
    failoverMsg = settings.getValue("rigFailoverMsg");
    alsoSends.addTokens(settings.getValue("rigAlsoSends"), "\n", "");
    alsoSends.removeEmptyStrings();
    udp = std::make_unique<juce::DatagramSocket>(true);
    if (! udp->bindToPort(Port)) applog::line("Backup rig: UDP port " + juce::String(Port) + " is busy");
    rx = std::thread([this] { receiveLoop(); });
    tcpThread = std::thread([this] { tcpLoop(); });
    startTimer(50);
}

RigLink::~RigLink()
{
    stopTimer();
    *alive = nullptr;
    running.store(false);
    if (udp) udp->shutdown();
    if (tcp) tcp->close();
    if (rx.joinable()) rx.join();
    if (tcpThread.joinable()) tcpThread.join();
}

void RigLink::save()
{
    settings.setValue("rigRole", roleName); settings.setValue("rigPeer", peer);
    settings.setValue("rigLatencyMs", latency.load()); settings.setValue("rigTimeoutMs", (int) hb.timeoutMs);
    settings.setValue("rigFailoverMsg", failoverMsg); settings.setValue("rigAlsoSends", alsoSends.joinIntoString("\n"));
    settings.saveIfNeeded();
}

void RigLink::setRole(const juce::String& r)
{
    const auto n = r == "primary" || r == "backup" ? r : juce::String("off");
    if (n != roleName) { if (roleName != "off" && peer.isNotEmpty()) send(obj({ { "t", "unpair" } })); peer = {}; failover.store(false); lostSaid = false; }
    roleName = n;
    save();
    applog::line("Backup rig: " + roleName);
}

void RigLink::setOptions(const juce::var& o)
{
    if (o.hasProperty("latencyMs")) latency.store(juce::jlimit(20, 100, (int) o["latencyMs"]));
    if (o.hasProperty("timeoutMs")) hb.timeoutMs = juce::jlimit(200, 5000, (int) o["timeoutMs"]);
    if (o.hasProperty("failoverMsg")) failoverMsg = o["failoverMsg"].toString();
    if (auto* a = o["alsoSends"].getArray()) { alsoSends.clear(); for (auto& x : *a) alsoSends.add(x.toString()); }
    save();
}

juce::var RigLink::info()
{
    juce::Array<juce::var> ips; for (auto& a : localIPs()) ips.add(a);
    juce::Array<juce::var> also; for (auto& a : alsoSends) also.add(a);
    const double now = hostMs();
    return obj({ { "role", roleName }, { "code", code }, { "peer", peer }, { "paired", paired() }, { "addresses", ips }, { "offsetMs", sync.offset() }, { "rttMs", sync.rtt() },
                 { "synced", sync.ready() }, { "since", hb.since(now) }, { "failover", failover.load() }, { "latencyMs", latency.load() }, { "timeoutMs", hb.timeoutMs },
                 { "failoverMsg", failoverMsg }, { "alsoSends", also }, { "found", found }, { "status", status }, { "statusAge", lastPeerStatus < 0 ? -1.0 : now - lastPeerStatus },
                 { "driftMs", drift.lastMs() }, { "driftWorstMs", drift.worstMs() } });
}

void RigLink::pair(const juce::String& ip, const juce::String& c) { send(obj({ { "t", "pair" }, { "code", c } }), ip); }
void RigLink::unpair() { if (peer.isNotEmpty()) send(obj({ { "t", "unpair" } })); peer = {}; failover.store(false); lostSaid = false; save(); }

void RigLink::send(const juce::var& m, const juce::String& to)
{
    const auto dest = to.isNotEmpty() ? to : peer;
    if (! udp || dest.isEmpty()) return;
    const auto text = juce::JSON::toString(m, true);
    udp->write(dest, Port, text.toRawUTF8(), (int) text.getNumBytesAsUTF8());
}

void RigLink::sendState()
{
    if (roleName != "primary" || ! paired() || ! stateNow) return;
    auto st = stateNow();
    if (auto* o = st.getDynamicObject()) o->setProperty("t", "st");
    send(st);
}

void RigLink::sendCommand(const juce::var& cmd)
{
    if (roleName != "primary" || ! paired()) return;
    auto c = cmd; if (auto* o = c.getDynamicObject()) o->setProperty("t", "cmd");
    send(c); send(c); // twice: UDP may drop one (the backup ignores a repeat by id)
}

void RigLink::sendStatus(const juce::var& st)
{
    if (roleName != "backup" || ! paired()) return;
    drift.add((double) st["driftMs"]);
    auto c = st; if (auto* o = c.getDynamicObject()) { o->setProperty("t", "status"); o->setProperty("offsetMs", sync.offset()); o->setProperty("failover", failover.load()); }
    send(c);
}

void RigLink::takeOver()
{
    if (roleName != "backup" || failover.load()) return;
    failover.store(true); lostSaid = true;
    applog::line("Backup rig: taking over (by hand)");
    if (emit) emit("rigLost", obj({ { "manual", true }, { "failoverMsg", failoverMsg } }));
}

void RigLink::returnControl() { failover.store(false); lostSaid = false; applog::line("Backup rig: control back to the primary"); }

void RigLink::timerCallback()
{
    ++tick;
    const double now = hostMs();
    if (roleName == "primary" && paired() && tick % 2 == 0) sendState();
    if (roleName == "backup") {
        if (! paired() && tick % 20 == 0) // "a backup is here" (the primary lists it; pairing needs the code shown here)
            if (udp) { const auto t = juce::JSON::toString(obj({ { "t", "here" }, { "name", juce::SystemStats::getComputerName() } }), true); udp->write("255.255.255.255", Port, t.toRawUTF8(), (int) t.getNumBytesAsUTF8()); }
        if (paired() && tick % 5 == 0) send(obj({ { "t", "ping" }, { "t0", now } }));
        if (paired() && hb.seen() && hb.lost(now) && ! lostSaid) {
            lostSaid = true; failover.store(true);
            applog::line("Backup rig: PRIMARY LOST (no heartbeat for " + juce::String((int) hb.since(now)) + " ms), the backup is live");
            if (emit) emit("rigLost", obj({ { "manual", false }, { "failoverMsg", failoverMsg }, { "silentMs", hb.since(now) } }));
        }
    }
}

void RigLink::receiveLoop()
{
    juce::HeapBlock<char> buf(65536);
    while (running.load()) {
        if (! udp || udp->waitUntilReady(true, 200) != 1) continue;
        juce::String from; int fromPort = 0;
        const int n = udp->read(buf.get(), 65535, false, from, fromPort);
        if (n <= 0) continue;
        if (localIPs().contains(from) && roleName != "off") { // our own broadcast
            const auto v = juce::JSON::parse(juce::String::fromUTF8(buf.get(), n));
            if (v["t"].toString() == "here") continue;
        }
        const auto v = juce::JSON::parse(juce::String::fromUTF8(buf.get(), n));
        if (! v.isObject()) continue;
        const double at = hostMs();
        auto alive_ = alive;
        juce::MessageManager::callAsync([alive_, v, from, at] { if (*alive_) { auto* self = *alive_; auto m = v; if (auto* o = m.getDynamicObject()) o->setProperty("_rx", at); self->handle(m, from); } });
    }
}

void RigLink::handle(const juce::var& m, const juce::String& from)
{
    const auto t = m["t"].toString();
    const double now = (double) m["_rx"] > 0 ? (double) m["_rx"] : hostMs();
    if (t == "here" && roleName == "primary") {
        auto* a = found.getArray();
        bool have = false; for (auto& x : *a) have |= x["ip"].toString() == from;
        if (! have) a->add(obj({ { "ip", from }, { "name", m["name"] } }));
    } else if (t == "pair" && roleName == "backup") {
        if (m["code"].toString() != code) { send(obj({ { "t", "nopair" } }), from); return; }
        peer = from; save(); failover.store(false); lostSaid = false;
        send(obj({ { "t", "paired" }, { "name", juce::SystemStats::getComputerName() } }), from);
        applog::line("Backup rig: paired with the primary at " + from);
        if (emit) emit("rigPaired", obj({ { "peer", from } }));
    } else if (t == "paired" && roleName == "primary") {
        peer = from; save();
        applog::line("Backup rig: paired with the backup at " + from);
        if (emit) emit("rigPaired", obj({ { "peer", from } }));
    } else if (t == "nopair") {
        if (emit) emit("rigPaired", obj({ { "error", "Wrong code" } }));
    } else if (t == "unpair" && from == peer) {
        peer = {}; save(); failover.store(false); lostSaid = false;
        if (emit) emit("rigPaired", obj({ { "peer", "" } }));
    } else if (from != peer) {
        return; // only the paired computer from here on
    } else if (t == "ping" && roleName == "primary") {
        send(obj({ { "t", "pong" }, { "t0", m["t0"] }, { "t1", now }, { "t2", hostMs() } }));
    } else if (t == "pong" && roleName == "backup") {
        sync.add((double) m["t0"], (double) m["t1"], (double) m["t2"], now);
    } else if (t == "st" && roleName == "backup") {
        hb.beat(now);
        if (lostSaid && failover.load()) { lostSaid = false; if (emit) emit("rigBack", obj({})); applog::line("Backup rig: the primary is back"); return; }
        if (failover.load()) return; // live: the backup leads until the user hands control back
        auto s = m; if (auto* o = s.getDynamicObject()) { o->setProperty("atLocal", sync.toLocal((double) m["atMs"])); o->setProperty("synced", sync.ready()); }
        if (emit) emit("rigState", s);
    } else if (t == "cmd" && roleName == "backup" && ! failover.load()) {
        auto c = m; if (auto* o = c.getDynamicObject()) if (m.hasProperty("atMs")) o->setProperty("atLocal", sync.toLocal((double) m["atMs"]));
        if (emit) emit("rigCommand", c);
    } else if (t == "status" && roleName == "primary") {
        status = m; lastPeerStatus = now;
    }
}

// ---- TCP (the backup listens): "LIB" -> its library list; "PKG <bytes>" + the bytes -> a setlist package
void RigLink::tcpLoop()
{
    tcp = std::make_unique<juce::StreamingSocket>();
    if (! tcp->createListener(Port + 1)) { applog::line("Backup rig: TCP port " + juce::String(Port + 1) + " is busy"); return; }
    while (running.load()) {
        std::unique_ptr<juce::StreamingSocket> c(tcp->waitForNextConnection());
        if (! c || ! running.load()) continue;
        if (roleName != "backup" || c->getHostName() != peer) continue;
        juce::String line;
        if (! readLine(*c, line)) continue;
        if (line == "LIB") {
            juce::var lib;
            auto alive_ = alive;
            juce::WaitableEvent got;
            juce::MessageManager::callAsync([&, alive_] { if (*alive_ && libraryList) lib = libraryList(); got.signal(); });
            got.wait(3000);
            const auto text = juce::JSON::toString(lib, true);
            c->write(text.toRawUTF8(), (int) text.getNumBytesAsUTF8());
        } else if (line.startsWith("PKG ")) {
            const auto size = line.substring(4).getLargeIntValue();
            const auto f = juce::File::createTempFile(".setline");
            juce::FileOutputStream out(f);
            juce::HeapBlock<char> buf(1 << 16);
            juce::int64 got = 0;
            while (got < size) { const int n = c->read(buf.get(), (int) juce::jmin<juce::int64>(1 << 16, size - got), true); if (n <= 0) break; out.write(buf.get(), (size_t) n); got += n; }
            out.flush();
            const bool ok = got == size;
            c->write(ok ? "OK\n" : "FAIL\n", ok ? 3 : 5);
            if (ok) { auto alive_ = alive; juce::MessageManager::callAsync([alive_, f] { if (*alive_ && (*alive_)->packageArrived) (*alive_)->packageArrived(f); }); }
        }
    }
}

void RigLink::requestLibrary()
{
    if (roleName != "primary" || ! paired()) return;
    auto alive_ = alive; const auto ip = peer;
    std::thread([alive_, ip] {
        juce::StreamingSocket s; juce::String text;
        if (s.connect(ip, Port + 1, 3000)) { s.write("LIB\n", 4); char b[4096]; for (;;) { const int n = s.read(b, sizeof b, true); if (n <= 0) break; text += juce::String::fromUTF8(b, n); } }
        const auto v = juce::JSON::parse(text);
        juce::MessageManager::callAsync([alive_, v] { if (*alive_ && (*alive_)->emit) (*alive_)->emit("rigLibrary", v.isArray() ? v : obj({ { "error", "The backup didn't answer" } })); });
    }).detach();
}

juce::String RigLink::sendPackage(const juce::File& pkg, std::function<void(double)> progress)
{
    if (! paired()) return "Not paired with a backup";
    juce::StreamingSocket s;
    if (! s.connect(peer, Port + 1, 3000)) return "Couldn't reach the backup";
    const auto size = pkg.getSize();
    const juce::String head = "PKG " + juce::String(size) + "\n";
    s.write(head.toRawUTF8(), head.length());
    juce::FileInputStream in(pkg);
    juce::HeapBlock<char> buf(1 << 16); juce::int64 sent = 0;
    while (! in.isExhausted()) { const int n = in.read(buf.get(), 1 << 16); if (n <= 0 || s.write(buf.get(), n) != n) return "The transfer broke off"; sent += n; if (progress) progress((double) sent / (double) juce::jmax<juce::int64>(1, size)); }
    juce::String reply; readLine(s, reply);
    return reply == "OK" ? juce::String() : juce::String("The backup didn't take it");
}

} // namespace setline::gui
