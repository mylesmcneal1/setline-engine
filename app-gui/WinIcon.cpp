// set.Line (Windows): gives a window the app's own icon (resource 1, assets/brand/setline.ico) for its title bar,
// the taskbar button and Alt+Tab, at the sizes this window's DPI needs. JUCE's windows otherwise keep the class
// icon Windows picked, which can be the generic one. Kept apart from the JUCE sources so <windows.h> stays here.
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace setline::gui {

void setWindowIcon(void* nativeHandle)
{
    auto* hwnd = static_cast<HWND>(nativeHandle);
    if (hwnd == nullptr) return;
    const UINT dpi = GetDpiForWindow(hwnd) ? GetDpiForWindow(hwnd) : 96;
    const int big = MulDiv(GetSystemMetrics(SM_CXICON), (int) dpi, 96), small = MulDiv(GetSystemMetrics(SM_CXSMICON), (int) dpi, 96);
    HINSTANCE inst = GetModuleHandleW(nullptr);
    // LR_SHARED: Windows owns these (loaded once, never freed by us).
    if (auto* b = (HICON) LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, big, big, LR_SHARED))
        SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM) b);
    if (auto* s = (HICON) LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, small, small, LR_SHARED))
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM) s);
}

} // namespace setline::gui
#else
namespace setline::gui { void setWindowIcon(void*) {} }
#endif
