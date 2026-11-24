// macOS speech through AVSpeechSynthesizer, rendered into buffers (writeUtterance, macOS 10.15+),
// never to the sound card.
#include "Speech.h"
#import <AVFoundation/AVFoundation.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <mutex>

namespace setline::gui::speech {

namespace {
juce::String str(NSString* s) { return s ? juce::String::fromUTF8([s UTF8String]) : juce::String(); }
// SETLINE_SPEECH_DEBUG=1: progress on stderr (CI)
void dbg(const char* m, long a = 0) { if (std::getenv("SETLINE_SPEECH_DEBUG")) { std::fprintf(stderr, "speech-mac: %s %ld\n", m, a); std::fflush(stderr); } }
NSString* ns(const juce::String& s) { return [NSString stringWithUTF8String:s.toRawUTF8()]; }

// Shared with the synthesizer's callback, which may run on another thread and even after a timeout.
struct State {
    std::mutex m;
    std::vector<float> acc;
    double rate = 0;
    bool finished = false;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    ~State() { dispatch_release(done); }
};
} // namespace

std::vector<Voice> listVoices(juce::String& defaultId)
{
    std::vector<Voice> out;
    @autoreleasepool {
        AVSpeechSynthesisVoice* def = [AVSpeechSynthesisVoice voiceWithLanguage:[AVSpeechSynthesisVoice currentLanguageCode]];
        defaultId = def ? str(def.identifier) : juce::String();
        for (AVSpeechSynthesisVoice* v in [AVSpeechSynthesisVoice speechVoices]) {
            Voice x;
            x.id = str(v.identifier);
            x.name = str(v.name);
            x.lang = str(v.language);
            x.quality = (int) v.quality; // AVSpeechSynthesisVoiceQuality: 1 default, 2 enhanced, 3 premium
            if (x.id.isNotEmpty() && x.name.isNotEmpty()) out.push_back(x);
        }
    }
    return out;
}

bool render(const juce::String& text, const juce::String& voiceId, double speed, double /*wantRate*/,
            std::vector<float>& out, double& rateOut, juce::String& error)
{
    out.clear();
    rateOut = 0;
    auto st = std::make_shared<State>();
    // One synthesizer for the app's lifetime (renders run one at a time on the Cues worker): releasing it
    // right after a render can pull it away while it is still finishing on its own queue.
    static AVSpeechSynthesizer* syn = [[AVSpeechSynthesizer alloc] init];
    @autoreleasepool {
        AVSpeechUtterance* u = [AVSpeechUtterance speechUtteranceWithString:ns(text)];
        AVSpeechSynthesisVoice* v = voiceId.isNotEmpty() ? [AVSpeechSynthesisVoice voiceWithIdentifier:ns(voiceId)] : nil;
        if (v == nil) v = [AVSpeechSynthesisVoice voiceWithLanguage:[AVSpeechSynthesisVoice currentLanguageCode]];
        u.voice = v;
        const double r = AVSpeechUtteranceDefaultSpeechRate * speed;
        u.rate = (float) juce::jlimit((double) AVSpeechUtteranceMinimumSpeechRate, (double) AVSpeechUtteranceMaximumSpeechRate, r);
        dbg("writeUtterance, main thread", [NSThread isMainThread] ? 1 : 0);
        [syn writeUtterance:u toBufferCallback:^(AVAudioBuffer* buffer) {
            std::lock_guard<std::mutex> g(st->m);
            if (st->finished) return;
            AVAudioPCMBuffer* pcm = (AVAudioPCMBuffer*) buffer;
            if (! [pcm isKindOfClass:[AVAudioPCMBuffer class]] || pcm.frameLength == 0) { // the last buffer is empty
                st->finished = true;
                dispatch_semaphore_signal(st->done);
                return;
            }
            st->rate = pcm.format.sampleRate;
            const AVAudioFrameCount n = pcm.frameLength;
            auto& acc = st->acc;
            if (pcm.floatChannelData) { const float* d = pcm.floatChannelData[0]; acc.insert(acc.end(), d, d + n); }
            else if (pcm.int16ChannelData) { const int16_t* d = pcm.int16ChannelData[0]; for (AVAudioFrameCount i = 0; i < n; ++i) acc.push_back((float) d[i] / 32768.0f); }
            else if (pcm.int32ChannelData) { const int32_t* d = pcm.int32ChannelData[0]; for (AVAudioFrameCount i = 0; i < n; ++i) acc.push_back((float) ((double) d[i] / 2147483648.0)); }
        }];
    }
    // Some systems never send the empty last buffer: stop waiting once audio has stopped arriving for 1 s.
    size_t lastSize = 0;
    int quietWaits = 0;
    bool completed = false;
    for (int i = 0; i < 400; ++i) { // at most 20 s
        if (dispatch_semaphore_wait(st->done, dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC)) == 0) { completed = true; break; }
        size_t now;
        { std::lock_guard<std::mutex> g(st->m); now = st->acc.size(); }
        if (now > 0 && now == lastSize) { if (++quietWaits >= 20) break; } else quietWaits = 0;
        lastSize = now;
    }
    {
        std::lock_guard<std::mutex> g(st->m);
        st->finished = true;
        out = std::move(st->acc);
        rateOut = st->rate;
    }
    dbg("done waiting, samples", (long) out.size());
    if (! completed) [syn stopSpeakingAtBoundary:AVSpeechBoundaryImmediate]; // gave up waiting: stop it
    if (out.empty() || rateOut <= 0) { error = "The voice produced no audio."; return false; }
    return true;
}

} // namespace setline::gui::speech
