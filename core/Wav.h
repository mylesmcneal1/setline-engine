// Minimal WAV reader/writer for the test generator, offline render and self-test.
// The app itself reads stems through JUCE (WAV, AIFF, FLAC) and streams them from disk.
#pragma once
#include "Song.h"
#include <algorithm>
#include <cstdint>
#include <memory>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace setline {

// Writes interleaved-on-the-fly 24-bit PCM (or 32-bit float) from planar buffers.
inline bool writeWav(const std::string& path, const std::vector<std::vector<float>>& ch, double sr, bool float32 = false)
{
    FILE* f = std::fopen(path.c_str(), "wb");
    if (! f) return false;
    const uint16_t nch = (uint16_t) ch.size();
    const uint32_t frames = ch.empty() ? 0 : (uint32_t) ch[0].size();
    const uint16_t bps = float32 ? 32 : 24, fmt = float32 ? 3 : 1;
    const uint32_t blockAlign = nch * (bps / 8u), dataBytes = frames * blockAlign, rate = (uint32_t) sr;
    auto u32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto u16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); u32(36 + dataBytes); std::fwrite("WAVE", 1, 4, f);
    std::fwrite("fmt ", 1, 4, f); u32(16); u16(fmt); u16(nch); u32(rate); u32(rate * blockAlign); u16((uint16_t) blockAlign); u16(bps);
    std::fwrite("data", 1, 4, f); u32(dataBytes);
    std::vector<uint8_t> buf; buf.reserve((size_t) blockAlign * 4096);
    for (uint32_t i = 0; i < frames; ++i) {
        for (uint16_t c = 0; c < nch; ++c) {
            float v = ch[c][i];
            if (float32) { uint8_t b[4]; std::memcpy(b, &v, 4); buf.insert(buf.end(), b, b + 4); }
            else {
                v = v > 1.f ? 1.f : (v < -1.f ? -1.f : v);
                int32_t x = (int32_t) (v * 8388607.0f);
                buf.push_back((uint8_t) (x & 255)); buf.push_back((uint8_t) ((x >> 8) & 255)); buf.push_back((uint8_t) ((x >> 16) & 255));
            }
        }
        if (buf.size() >= (size_t) blockAlign * 4096) { std::fwrite(buf.data(), 1, buf.size(), f); buf.clear(); }
    }
    std::fwrite(buf.data(), 1, buf.size(), f);
    std::fclose(f);
    return true;
}

// Whole-file reader (PCM 16/24/32, float 32, WAVE_FORMAT_EXTENSIBLE).
class WavSource : public SampleSource {
public:
    static std::shared_ptr<WavSource> load(const std::string& path, std::string& err)
    {
        FILE* f = std::fopen(path.c_str(), "rb");
        if (! f) { err = "Can't open " + path; return nullptr; }
        std::vector<uint8_t> b;
        std::fseek(f, 0, SEEK_END); long sz = std::ftell(f); std::fseek(f, 0, SEEK_SET);
        b.resize((size_t) sz); size_t got = std::fread(b.data(), 1, b.size(), f); std::fclose(f); b.resize(got);
        if (b.size() < 12 || std::memcmp(b.data(), "RIFF", 4) || std::memcmp(b.data() + 8, "WAVE", 4)) { err = path + " is not a WAV file"; return nullptr; }
        auto rd16 = [&](size_t o) { return (uint32_t) b[o] | ((uint32_t) b[o + 1] << 8); };
        auto rd32 = [&](size_t o) { return rd16(o) | (rd16(o + 2) << 16); };
        uint16_t fmt = 0, nch = 0, bps = 0; uint32_t rate = 0; size_t dataOff = 0, dataLen = 0;
        for (size_t o = 12; o + 8 <= b.size();) {
            const uint32_t len = rd32(o + 4);
            if (! std::memcmp(b.data() + o, "fmt ", 4)) {
                fmt = (uint16_t) rd16(o + 8); nch = (uint16_t) rd16(o + 10); rate = rd32(o + 12); bps = (uint16_t) rd16(o + 22);
                if (fmt == 0xFFFE && len >= 40) fmt = (uint16_t) rd16(o + 32);
            } else if (! std::memcmp(b.data() + o, "data", 4)) { dataOff = o + 8; dataLen = std::min<size_t>(len, b.size() - dataOff); break; }
            o += 8 + len + (len & 1);
        }
        if (! nch || ! dataOff || ! (fmt == 1 || fmt == 3)) { err = path + ": unsupported WAV format"; return nullptr; }
        auto w = std::make_shared<WavSource>();
        w->sr = rate; const size_t bytes = bps / 8u, frames = dataLen / (bytes * nch);
        w->data.assign(nch, std::vector<float>(frames));
        for (size_t i = 0; i < frames; ++i)
            for (uint16_t c = 0; c < nch; ++c) {
                const uint8_t* p = b.data() + dataOff + (i * nch + c) * bytes;
                float v = 0;
                if (fmt == 3 && bps == 32) std::memcpy(&v, p, 4);
                else if (bps == 16) v = (int16_t) (p[0] | (p[1] << 8)) / 32768.0f;
                else if (bps == 24) { int32_t x = (p[0] << 8) | (p[1] << 16) | (p[2] << 24); v = (x >> 8) / 8388608.0f; }
                else if (bps == 32) { int32_t x; std::memcpy(&x, p, 4); v = x / 2147483648.0f; }
                w->data[c][i] = v;
            }
        return w;
    }

    int numChannels() const override { return (int) data.size(); }
    int64_t length() const override { return data.empty() ? 0 : (int64_t) data[0].size(); }
    double sampleRate() const override { return sr; }
    bool read(float* const* dest, int64_t start, int n) override
    {
        for (size_t c = 0; c < data.size(); ++c)
            for (int i = 0; i < n; ++i) {
                const int64_t s = start + i;
                dest[c][i] = (s >= 0 && s < length()) ? data[c][(size_t) s] : 0.0f;
            }
        return true;
    }
    std::vector<std::vector<float>> data;
    double sr = 48000;
};

} // namespace setline
