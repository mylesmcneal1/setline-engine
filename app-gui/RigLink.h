// set.Line desktop app (7d): the backup rig. Two computers on the band's network: the primary plays, the backup
// follows it in lockstep (core/Lockstep.h) and takes over if the primary goes quiet.
// - UDP (port 47800): heartbeat + state from the primary every 100 ms (and at once on every transport change),
//   ping / pong for the clock offset, transport commands, discovery ("a backup is here": its name + pairing code).
// - TCP (port 47801, the backup): the library list for the match check, and a setlist package sent to it.
// Everything here runs off the audio thread; nothing the backup does can touch the primary's audio.
#pragma once
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_data_structures/juce_data_structures.h>
#include <atomic>
#include <functional>
#include <thread>
#include "../core/Lockstep.h"

namespace setline::gui {

class RigLink : private juce::Timer {
public:
    explicit RigLink(juce::PropertiesFile& settings);
    ~RigLink() override;

    // "off" | "primary" | "backup"
    juce::String role() const { return roleName; }
    void setRole(const juce::String& r);
    juce::var info();                       // {role, code, peer, paired, addresses, offsetMs, rttMs, since, lost, failover, latencyMs, timeoutMs, found: [...]}
    void pair(const juce::String& ip, const juce::String& code); // primary: pair with the backup at ip
    void unpair();
    void setOptions(const juce::var& o);    // {latencyMs 20-100, timeoutMs, failoverMsg, alsoSends: [port...]}
    int latencyMs() const { return latency.load(); }

    // primary: the state the backup follows (sent every 100 ms and at once from transportChanged)
    std::function<juce::var()> stateNow;    // {playing, songId, verId, pos (samples), atMs (host ms when pos leaves)}
    void transportChanged() { sendState(); }
    void sendCommand(const juce::var& cmd); // {kind: "jump", at, to} ... (sample based: both play the same song)
    // backup: what happens (message thread): "rigState" (the primary's state, times already on this clock),
    // "rigCommand", "rigLost", "rigBack", "rigPaired", "rigLibrary" (primary: the backup's library), "rigPackage"
    std::function<void(const juce::String&, const juce::var&)> emit;
    // backup -> primary: its status (offset, drift, missing songs), shown on the primary
    void sendStatus(const juce::var& st);
    std::function<juce::var()> libraryList; // backup: [{id, name, vers: [...], audio: [...]}]
    std::function<void(const juce::File&)> packageArrived; // backup: a setlist package from the primary (a temp file)
    void requestLibrary();                  // primary -> "rigLibrary"
    juce::String sendPackage(const juce::File& pkg, std::function<void(double)> progress); // primary, blocking (a thread)
    void takeOver();                        // backup: failover now (the button)
    void returnControl();                   // backup: the primary is back, the user said so
    bool backupLive() const { return failover.load(); }
    bool midiMuted() const { return roleName == "backup" && paired() && ! failover.load(); }
    bool paired() const { return peer.isNotEmpty(); }
    double hostMs() const { return juce::Time::getMillisecondCounterHiRes(); }

private:
    void timerCallback() override;
    void receiveLoop();
    void tcpLoop();
    void handle(const juce::var& m, const juce::String& from);
    void send(const juce::var& m, const juce::String& to = {});
    void sendState();
    void save();

    juce::PropertiesFile& settings;
    juce::String roleName = "off", peer, code, failoverMsg, lastSentState;
    juce::StringArray alsoSends;
    std::atomic<int> latency { 50 };
    RigClockSync sync;
    RigHeartbeat hb;
    RigDrift drift;
    std::atomic<bool> failover { false }, running { true };
    bool lostSaid = false;
    juce::var status, found = juce::var(juce::Array<juce::var>());
    std::unique_ptr<juce::DatagramSocket> udp;
    std::unique_ptr<juce::StreamingSocket> tcp;
    std::thread rx, tcpThread;
    int tick = 0;
    double lastPeerStatus = -1;
    std::shared_ptr<RigLink*> alive = std::make_shared<RigLink*>(this);
    static constexpr int Port = 47800;
};

} // namespace setline::gui
