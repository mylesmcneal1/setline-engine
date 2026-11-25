#include "Package.h"
#include <algorithm>
#include <cstring>

namespace setline::gui::package {

namespace {
uint32_t crcTable[256];
const bool crcReady = [] {
    for (uint32_t i = 0; i < 256; ++i) { uint32_t c = i; for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1; crcTable[i] = c; }
    return true;
}();
uint32_t crcUpdate(uint32_t crc, const uint8_t* p, size_t n) { crc = ~crc; while (n--) crc = crcTable[(crc ^ *p++) & 0xff] ^ (crc >> 8); return ~crc; }

void put16(juce::OutputStream& o, uint32_t v) { o.writeShort((short) (v & 0xffff)); }
void put32(juce::OutputStream& o, uint32_t v) { o.writeInt((int) v); }
void put64(juce::OutputStream& o, uint64_t v) { o.writeInt64((juce::int64) v); }

struct Written { juce::String name; uint64_t offset, size; uint32_t crc; };

// DOS date/time of now
void dosNow(uint16_t& time, uint16_t& date)
{
    const auto t = juce::Time::getCurrentTime();
    time = (uint16_t) ((t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() / 2));
    date = (uint16_t) (((t.getYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDayOfMonth());
}
} // namespace

juce::String write(const juce::File& to, const std::vector<Entry>& entries, std::atomic<bool>& cancel,
                   const std::function<void(int64_t, int64_t, const juce::String&)>& progress)
{
    juce::ignoreUnused(crcReady);
    const auto part = to.getSiblingFile(to.getFileName() + ".part");
    to.getParentDirectory().createDirectory();
    part.deleteFile();
    int64_t total = 0, done = 0;
    for (auto& e : entries) total += e.source != juce::File() ? e.source.getSize() : (int64_t) e.text.getNumBytesAsUTF8();
    std::vector<Written> written;
    uint16_t dt, dd; dosNow(dt, dd);
    {
        juce::FileOutputStream out(part, 1 << 20);
        if (! out.openedOk()) return "Couldn't write " + to.getFullPathName();
        std::vector<uint8_t> buf(1 << 20);
        for (auto& e : entries) {
            if (cancel.load()) { out.flush(); break; }
            const auto nameUtf8 = e.name.toUTF8();
            const auto nameLen = (uint32_t) strlen(nameUtf8);
            const uint64_t offset = (uint64_t) out.getPosition();
            // local header: sizes and CRC follow the data (bit 3), Zip64 extra reserved
            put32(out, 0x04034b50); put16(out, 45); put16(out, 0x0808); put16(out, 0); put16(out, dt); put16(out, dd);
            put32(out, 0); put32(out, 0xffffffffu); put32(out, 0xffffffffu); put16(out, nameLen); put16(out, 20);
            out.write(nameUtf8, nameLen);
            put16(out, 0x0001); put16(out, 16); put64(out, 0); put64(out, 0);
            uint32_t crc = 0; uint64_t size = 0;
            if (e.source != juce::File()) {
                juce::FileInputStream in(e.source);
                if (! in.openedOk()) return "Couldn't read " + e.source.getFullPathName();
                for (;;) {
                    if (cancel.load()) break;
                    const int n = in.read(buf.data(), (int) buf.size());
                    if (n <= 0) break;
                    crc = crcUpdate(crc, buf.data(), (size_t) n);
                    if (! out.write(buf.data(), (size_t) n)) return "Couldn't write " + to.getFullPathName() + " (is the disk full?)";
                    size += (uint64_t) n; done += n;
                    if (progress) progress(done, total, e.name);
                }
            } else {
                const auto t = e.text.toUTF8();
                const auto n = strlen(t);
                crc = crcUpdate(0, (const uint8_t*) t.getAddress(), n);
                out.write(t, n); size = n; done += (int64_t) n;
                if (progress) progress(done, total, e.name);
            }
            if (cancel.load()) break;
            // data descriptor (Zip64 sizes)
            put32(out, 0x08074b50); put32(out, crc); put64(out, size); put64(out, size);
            written.push_back({ e.name, offset, size, crc });
        }
        if (! cancel.load()) {
            const uint64_t cdStart = (uint64_t) out.getPosition();
            for (auto& w : written) {
                const auto nameUtf8 = w.name.toUTF8();
                const auto nameLen = (uint32_t) strlen(nameUtf8);
                put32(out, 0x02014b50); put16(out, 45); put16(out, 45); put16(out, 0x0808); put16(out, 0); put16(out, dt); put16(out, dd);
                put32(out, w.crc); put32(out, 0xffffffffu); put32(out, 0xffffffffu); put16(out, nameLen); put16(out, 28); put16(out, 0);
                put16(out, 0); put16(out, 0); put32(out, 0); put32(out, 0xffffffffu);
                out.write(nameUtf8, nameLen);
                put16(out, 0x0001); put16(out, 24); put64(out, w.size); put64(out, w.size); put64(out, w.offset);
            }
            const uint64_t cdEnd = (uint64_t) out.getPosition(), cdSize = cdEnd - cdStart;
            // Zip64 end of central directory + locator, then the classic end record pointing at them
            put32(out, 0x06064b50); put64(out, 44); put16(out, 45); put16(out, 45); put32(out, 0); put32(out, 0);
            put64(out, written.size()); put64(out, written.size()); put64(out, cdSize); put64(out, cdStart);
            put32(out, 0x07064b50); put32(out, 0); put64(out, cdEnd); put32(out, 1);
            put32(out, 0x06054b50); put16(out, 0); put16(out, 0); put16(out, 0xffff); put16(out, 0xffff); put32(out, 0xffffffffu); put32(out, 0xffffffffu); put16(out, 0);
            out.flush();
            if (out.getStatus().failed()) return "Couldn't write " + to.getFullPathName() + " (is the disk full?)";
        }
    }
    if (cancel.load()) { part.deleteFile(); return "cancelled"; }
    to.deleteFile();
    if (! part.moveFileTo(to)) { part.deleteFile(); return "Couldn't write " + to.getFullPathName(); }
    return {};
}

juce::String list(const juce::File& zip, std::vector<ZipItem>& items)
{
    items.clear();
    juce::FileInputStream in(zip);
    if (! in.openedOk()) return "Couldn't open " + zip.getFullPathName();
    const int64_t len = in.getTotalLength();
    // the end record is in the last 64 KB (plus its 22 bytes)
    const int64_t from = std::max<int64_t>(0, len - 65557);
    juce::MemoryBlock tail; in.setPosition(from); in.readIntoMemoryBlock(tail, len - from);
    const auto* t = (const uint8_t*) tail.getData();
    int64_t eocd = -1;
    for (int64_t i = (int64_t) tail.getSize() - 22; i >= 0; --i) if (t[i] == 0x50 && t[i + 1] == 0x4b && t[i + 2] == 0x05 && t[i + 3] == 0x06) { eocd = from + i; break; }
    if (eocd < 0) return "Not a set.Line package (no zip directory).";
    in.setPosition(eocd + 10);
    uint64_t count = (uint16_t) in.readShort(); in.readInt();
    uint64_t cdSize = (uint32_t) in.readInt(), cdOff = (uint32_t) in.readInt();
    if (count == 0xffff || cdOff == 0xffffffffu) {
        in.setPosition(eocd - 20);
        if ((uint32_t) in.readInt() != 0x07064b50) return "Not a set.Line package (bad Zip64 locator).";
        in.readInt(); const int64_t z64 = in.readInt64();
        in.setPosition(z64);
        if ((uint32_t) in.readInt() != 0x06064b50) return "Not a set.Line package (bad Zip64 record).";
        in.readInt64(); in.readShort(); in.readShort(); in.readInt(); in.readInt(); in.readInt64();
        count = (uint64_t) in.readInt64(); cdSize = (uint64_t) in.readInt64(); cdOff = (uint64_t) in.readInt64();
    }
    juce::ignoreUnused(cdSize);
    in.setPosition((int64_t) cdOff);
    for (uint64_t k = 0; k < count; ++k) {
        if ((uint32_t) in.readInt() != 0x02014b50) return "Not a set.Line package (bad directory).";
        in.readShort(); in.readShort(); in.readShort();
        const uint16_t method = (uint16_t) in.readShort(); in.readShort(); in.readShort();
        const uint32_t crc = (uint32_t) in.readInt();
        uint64_t csize = (uint32_t) in.readInt(), usize = (uint32_t) in.readInt();
        const uint16_t nlen = (uint16_t) in.readShort(), xlen = (uint16_t) in.readShort(), clen = (uint16_t) in.readShort();
        in.readShort(); in.readShort(); in.readInt();
        uint64_t off = (uint32_t) in.readInt();
        juce::MemoryBlock nm; in.readIntoMemoryBlock(nm, nlen);
        const int64_t xstart = in.getPosition();
        while (in.getPosition() + 4 <= xstart + xlen) {
            const uint16_t id = (uint16_t) in.readShort(), sz = (uint16_t) in.readShort();
            const int64_t next = in.getPosition() + sz;
            if (id == 0x0001) {
                if (usize == 0xffffffffu) usize = (uint64_t) in.readInt64();
                if (csize == 0xffffffffu) csize = (uint64_t) in.readInt64();
                if (off == 0xffffffffu) off = (uint64_t) in.readInt64();
            }
            in.setPosition(next);
        }
        in.setPosition(xstart + xlen + clen);
        ZipItem it; it.name = juce::String::fromUTF8((const char*) nm.getData(), (int) nm.getSize()); it.crc = crc; it.method = method; it.size = (int64_t) csize;
        // the data starts after the local header (its own name and extra lengths)
        const auto back = in.getPosition();
        in.setPosition((int64_t) off + 26);
        const uint16_t ln = (uint16_t) in.readShort(), lx = (uint16_t) in.readShort();
        it.offset = (int64_t) off + 30 + ln + lx;
        in.setPosition(back);
        items.push_back(it);
    }
    return {};
}

bool extract(const juce::File& zip, const ZipItem& item, const juce::File& to)
{
    if (item.method != 0) return false; // packages store their entries
    juce::FileInputStream in(zip);
    if (! in.openedOk() || ! to.getParentDirectory().createDirectory()) return false;
    const auto part = to.getSiblingFile(to.getFileName() + ".part");
    {
        juce::FileOutputStream out(part);
        if (! out.openedOk()) return false;
        out.setPosition(0); out.truncate();
        in.setPosition(item.offset);
        std::vector<uint8_t> buf(1 << 20);
        int64_t left = item.size; uint32_t crc = 0;
        while (left > 0) {
            const int n = in.read(buf.data(), (int) std::min<int64_t>(left, (int64_t) buf.size()));
            if (n <= 0) break;
            crc = crcUpdate(crc, buf.data(), (size_t) n);
            out.write(buf.data(), (size_t) n); left -= n;
        }
        out.flush();
        if (left != 0 || crc != item.crc || out.getStatus().failed()) { part.deleteFile(); return false; }
    }
    to.deleteFile();
    return part.moveFileTo(to);
}

juce::String readText(const juce::File& zip, const ZipItem& item)
{
    if (item.method != 0 || item.size > (64 << 20)) return {};
    juce::FileInputStream in(zip);
    if (! in.openedOk()) return {};
    in.setPosition(item.offset);
    juce::MemoryBlock mb; in.readIntoMemoryBlock(mb, item.size);
    return juce::String::fromUTF8((const char*) mb.getData(), (int) mb.getSize());
}

} // namespace setline::gui::package
