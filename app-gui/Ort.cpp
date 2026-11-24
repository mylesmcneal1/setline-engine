#include "Ort.h"
#include <onnxruntime_c_api.h>
#include <mutex>

#if JUCE_WINDOWS
 #include <windows.h>
#else
 #include <dlfcn.h>
#endif

#ifndef SETLINE_ORT_LIB_NAME
 #define SETLINE_ORT_LIB_NAME "onnxruntime"
#endif

namespace setline::gui::ort {

namespace {
std::mutex lock;
const OrtApi* theApi = nullptr;
juce::String theError, theVersion;
bool tried = false;
} // namespace

juce::File libraryFile()
{
    const auto exe = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
   #if JUCE_MAC
    return exe.getParentDirectory().getParentDirectory().getChildFile("Frameworks").getChildFile(SETLINE_ORT_LIB_NAME); // Contents/MacOS/.. /Frameworks
   #else
    return exe.getParentDirectory().getChildFile(SETLINE_ORT_LIB_NAME);
   #endif
}

const OrtApi* api(juce::String& error)
{
    std::lock_guard<std::mutex> g(lock);
    if (tried) { error = theError; return theApi; }
    tried = true;
    const auto f = libraryFile();
    if (! f.existsAsFile()) { theError = error = "The voice engine (ONNX Runtime) is missing from the app: " + f.getFullPathName(); return nullptr; }

    using GetApiBase = const OrtApiBase* (ORT_API_CALL*)();
    GetApiBase getBase = nullptr;
   #if JUCE_WINDOWS
    // Full path + altered search path: its own dependencies resolve from our folder, not System32's copy.
    HMODULE h = LoadLibraryExW(f.getFullPathName().toWideCharPointer(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (h == nullptr) { theError = error = "Couldn't load the voice engine (error " + juce::String((int) GetLastError()) + ")."; return nullptr; }
    getBase = reinterpret_cast<GetApiBase>(reinterpret_cast<void*>(GetProcAddress(h, "OrtGetApiBase")));
   #else
    void* h = dlopen(f.getFullPathName().toRawUTF8(), RTLD_NOW | RTLD_LOCAL);
    if (h == nullptr) { const char* e = dlerror(); theError = error = "Couldn't load the voice engine: " + juce::String(e ? e : "unknown error"); return nullptr; }
    getBase = reinterpret_cast<GetApiBase>(dlsym(h, "OrtGetApiBase"));
   #endif
    if (getBase == nullptr) { theError = error = "The voice engine library is damaged (no OrtGetApiBase)."; return nullptr; }
    const OrtApiBase* base = getBase();
    theVersion = base->GetVersionString();
    theApi = base->GetApi(ORT_API_VERSION); // the header matches the pinned library, so this is exact
    if (theApi == nullptr) theError = error = "The voice engine is version " + theVersion + ", which this build can't use.";
    return theApi; // the library stays loaded for the life of the app
}

juce::String loadedVersion() { std::lock_guard<std::mutex> g(lock); return theVersion; }

} // namespace setline::gui::ort
