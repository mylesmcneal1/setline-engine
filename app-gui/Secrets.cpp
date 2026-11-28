#include "Secrets.h"
#if JUCE_MAC
 #include <Security/Security.h>
#elif JUCE_WINDOWS
 #include <windows.h>
 #include <wincred.h>
 #pragma comment(lib, "advapi32.lib")
#endif

namespace setline::gui::secrets {

#if JUCE_MAC
namespace {
struct CF { CFTypeRef r = nullptr; ~CF() { if (r) CFRelease(r); } };
CFStringRef str(const juce::String& s) { return CFStringCreateWithCString(kCFAllocatorDefault, s.toRawUTF8(), kCFStringEncodingUTF8); }
// the query for one item: class generic password, service set.Line, account <name>
CFMutableDictionaryRef query(const juce::String& name)
{
    auto* q = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CF svc { str("set.Line") }, acc { str(name) };
    CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(q, kSecAttrService, svc.r);
    CFDictionarySetValue(q, kSecAttrAccount, acc.r);
    return q;
}
} // namespace

juce::String get(const juce::String& name)
{
    CF q { query(name) };
    CFDictionarySetValue((CFMutableDictionaryRef) q.r, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue((CFMutableDictionaryRef) q.r, kSecMatchLimit, kSecMatchLimitOne);
    CFTypeRef out = nullptr;
    if (SecItemCopyMatching((CFDictionaryRef) q.r, &out) != errSecSuccess || out == nullptr) return {};
    CF d { out };
    const auto* bytes = (const char*) CFDataGetBytePtr((CFDataRef) d.r);
    return juce::String::fromUTF8(bytes, (int) CFDataGetLength((CFDataRef) d.r));
}

bool set(const juce::String& name, const juce::String& value)
{
    if (value.isEmpty()) return remove(name);
    const auto utf8 = value.toUTF8();
    CF data { CFDataCreate(kCFAllocatorDefault, (const UInt8*) utf8.getAddress(), (CFIndex) strlen(utf8.getAddress())) };
    CF q { query(name) };
    auto* upd = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CF updRef { upd };
    CFDictionarySetValue(upd, kSecValueData, data.r);
    auto st = SecItemUpdate((CFDictionaryRef) q.r, (CFDictionaryRef) upd);
    if (st == errSecItemNotFound) {
        CFDictionarySetValue((CFMutableDictionaryRef) q.r, kSecValueData, data.r);
        CFDictionarySetValue((CFMutableDictionaryRef) q.r, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlock);
        CF label { str("set.Line updates (GitHub token)") };
        CFDictionarySetValue((CFMutableDictionaryRef) q.r, kSecAttrLabel, label.r);
        st = SecItemAdd((CFDictionaryRef) q.r, nullptr);
    }
    return st == errSecSuccess;
}

bool remove(const juce::String& name)
{
    CF q { query(name) };
    const auto st = SecItemDelete((CFDictionaryRef) q.r);
    return st == errSecSuccess || st == errSecItemNotFound;
}

#elif JUCE_WINDOWS
namespace { juce::String target(const juce::String& name) { return "set.Line/" + name; } }

juce::String get(const juce::String& name)
{
    PCREDENTIALW c = nullptr;
    if (! CredReadW(target(name).toWideCharPointer(), CRED_TYPE_GENERIC, 0, &c) || c == nullptr) return {};
    juce::String v = c->CredentialBlobSize > 0 ? juce::String::fromUTF8((const char*) c->CredentialBlob, (int) c->CredentialBlobSize) : juce::String();
    CredFree(c);
    return v;
}

bool set(const juce::String& name, const juce::String& value)
{
    if (value.isEmpty()) return remove(name);
    const auto utf8 = value.toUTF8();
    const auto t = target(name);
    CREDENTIALW c {};
    c.Type = CRED_TYPE_GENERIC;
    c.TargetName = const_cast<LPWSTR>(t.toWideCharPointer());
    c.CredentialBlobSize = (DWORD) strlen(utf8.getAddress());
    c.CredentialBlob = (LPBYTE) utf8.getAddress();
    c.Persist = CRED_PERSIST_LOCAL_MACHINE;
    c.UserName = const_cast<LPWSTR>(L"set.Line updates");
    return CredWriteW(&c, 0) != FALSE;
}

bool remove(const juce::String& name)
{
    return CredDeleteW(target(name).toWideCharPointer(), CRED_TYPE_GENERIC, 0) != FALSE || GetLastError() == ERROR_NOT_FOUND;
}

#else
juce::String get(const juce::String&) { return {}; }
bool set(const juce::String&, const juce::String&) { return false; }
bool remove(const juce::String&) { return true; }
#endif

} // namespace setline::gui::secrets
