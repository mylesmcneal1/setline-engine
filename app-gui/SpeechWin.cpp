// Windows speech through SAPI 5. Renders into memory (a WAV stream), never to the sound card.
#include "Speech.h"
#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <sapi.h>
#include <cmath>

namespace setline::gui::speech {

namespace {
struct ComInit {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ~ComInit() { if (SUCCEEDED(hr)) CoUninitialize(); }
};
template <class T> struct Ptr {
    T* p = nullptr;
    ~Ptr() { if (p) p->Release(); }
    T** put() { return &p; }
    T* operator->() const { return p; }
    explicit operator bool() const { return p != nullptr; }
};
struct CoStr {
    LPWSTR s = nullptr;
    ~CoStr() { if (s) CoTaskMemFree(s); }
    juce::String str() const { return s ? juce::String(s) : juce::String(); }
};

// Desktop voices, then the OneCore voices (Windows 10/11 "natural" set; SAPI can speak with them).
const wchar_t* categories[] = { SPCAT_VOICES, L"HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices" };

juce::String langName(const juce::String& lcidHex)
{
    const auto lcid = (LCID) lcidHex.upToFirstOccurrenceOf(";", false, false).getHexValue32();
    wchar_t buf[LOCALE_NAME_MAX_LENGTH] = {};
    return lcid != 0 && LCIDToLocaleName(lcid, buf, LOCALE_NAME_MAX_LENGTH, 0) > 0 ? juce::String(buf) : juce::String();
}
} // namespace

std::vector<Voice> listVoices(juce::String& defaultId)
{
    ComInit com;
    std::vector<Voice> out;
    juce::StringArray names;
    for (auto* catId : categories) {
        Ptr<ISpObjectTokenCategory> cat;
        if (FAILED(CoCreateInstance(CLSID_SpObjectTokenCategory, nullptr, CLSCTX_ALL, IID_PPV_ARGS(cat.put())))) continue;
        if (FAILED(cat->SetId(catId, FALSE))) continue;
        if (catId == categories[0]) { CoStr d; if (SUCCEEDED(cat->GetDefaultTokenId(&d.s))) defaultId = d.str(); }
        Ptr<IEnumSpObjectTokens> en;
        if (FAILED(cat->EnumTokens(nullptr, nullptr, en.put()))) continue;
        ULONG n = 0;
        en->GetCount(&n);
        for (ULONG i = 0; i < n; ++i) {
            Ptr<ISpObjectToken> t;
            if (FAILED(en->Item(i, t.put()))) continue;
            CoStr id, desc, nm, lang;
            t->GetId(&id.s);
            t->GetStringValue(nullptr, &desc.s);
            Ptr<ISpDataKey> attr;
            if (SUCCEEDED(t->OpenKey(L"Attributes", attr.put()))) { attr->GetStringValue(L"Name", &nm.s); attr->GetStringValue(L"Language", &lang.s); }
            Voice v;
            v.id = id.str();
            v.name = nm.str().isNotEmpty() ? nm.str() : desc.str().upToFirstOccurrenceOf(" - ", false, false);
            v.name = v.name.replace(" Desktop", "");
            v.lang = langName(lang.str());
            if (v.id.isEmpty() || v.name.isEmpty()) continue;
            if (names.contains(v.name)) v.name << " (" << (catId == categories[0] ? "desktop" : "OneCore") << ")";
            names.add(v.name);
            out.push_back(v);
        }
    }
    return out;
}

bool render(const juce::String& text, const juce::String& voiceId, double speed, double wantRate,
            std::vector<float>& out, double& rateOut, juce::String& error)
{
    ComInit com;
    out.clear();
    Ptr<ISpVoice> voice;
    if (FAILED(CoCreateInstance(CLSID_SpVoice, nullptr, CLSCTX_ALL, IID_PPV_ARGS(voice.put())))) { error = "Windows speech isn't available."; return false; }
    if (voiceId.isNotEmpty()) {
        Ptr<ISpObjectToken> tok;
        if (FAILED(CoCreateInstance(CLSID_SpObjectToken, nullptr, CLSCTX_ALL, IID_PPV_ARGS(tok.put())))
            || FAILED(tok->SetId(nullptr, voiceId.toWideCharPointer(), FALSE)) || FAILED(voice->SetVoice(tok.p))) {
            error = "That voice can't be used."; return false;
        }
    }
    // SAPI rate: -10 (a third of normal) .. +10 (three times normal).
    voice->SetRate((long) juce::jlimit(-10.0, 10.0, std::round(10.0 * std::log(juce::jmax(0.1, speed)) / std::log(3.0))));

    // SAPI renders at any standard PCM rate up to 48 kHz; higher show rates are resampled afterwards.
    const int rate = (int) wantRate;
    const bool direct = rate == 8000 || rate == 11025 || rate == 16000 || rate == 22050 || rate == 32000 || rate == 44100 || rate == 48000;
    rateOut = direct ? rate : 48000;
    WAVEFORMATEX w {};
    w.wFormatTag = WAVE_FORMAT_PCM; w.nChannels = 1; w.nSamplesPerSec = (DWORD) rateOut; w.wBitsPerSample = 16;
    w.nBlockAlign = 2; w.nAvgBytesPerSec = w.nSamplesPerSec * 2;

    Ptr<IStream> mem;
    Ptr<ISpStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, mem.put()))
        || FAILED(CoCreateInstance(CLSID_SpStream, nullptr, CLSCTX_ALL, IID_PPV_ARGS(stream.put())))
        || FAILED(stream->SetBaseStream(mem.p, SPDFID_WaveFormatEx, &w))
        || FAILED(voice->SetOutput(stream.p, TRUE))) { error = "Couldn't prepare speech output."; return false; }
    if (FAILED(voice->Speak(text.toWideCharPointer(), SPF_DEFAULT | SPF_IS_NOT_XML, nullptr))) { error = "The voice couldn't speak that text."; return false; }
    voice->SetOutput(nullptr, FALSE);

    STATSTG st {};
    HGLOBAL h = nullptr;
    if (FAILED(mem->Stat(&st, STATFLAG_NONAME)) || FAILED(GetHGlobalFromStream(mem.p, &h))) { error = "Couldn't read the speech."; return false; }
    const auto bytes = (size_t) st.cbSize.QuadPart;
    if (auto* d = static_cast<const int16_t*>(GlobalLock(h))) {
        out.resize(bytes / 2);
        for (size_t i = 0; i < out.size(); ++i) out[i] = (float) d[i] / 32768.0f;
        GlobalUnlock(h);
    }
    if (out.empty()) { error = "The voice produced no audio."; return false; }
    return true;
}

} // namespace setline::gui::speech
#endif
