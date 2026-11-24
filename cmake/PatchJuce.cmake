# set.Line: small, idempotent changes to JUCE, applied at configure time to the fetched JUCE sources
# (or FETCHCONTENT_SOURCE_DIR_JUCE). Each one checks for its marker, so it's applied exactly once,
# and stops the configure if JUCE's code has moved (a new JUCE version) instead of building without it.

# ---- 1. WebView2: dropped files with their real paths ----
# A page only gets File objects without paths. The page posts them with
# chrome.webview.postMessageWithAdditionalObjects (ui/src/pages/arrange.ts); here, in JUCE's
# WebMessageReceived handler, their paths (ICoreWebView2File::get_Path) are added to the event's
# payload as "paths" before it reaches the app's event listener (app-gui/Bridge.cpp, "setlineDrop").
set(_f "${JUCE_SOURCE_DIR}/modules/juce_gui_extra/native/juce_WebBrowserComponent_windows.cpp")
file(READ "${_f}" _src)
set(_changed FALSE)

# An earlier version of this file turned WebView2's drop handling off. Take that back out.
set(_oldDrop [=[        { // setline: AllowExternalDrop
            ComSmartPtr<ICoreWebView2Controller4> controller4;
            webViewController->QueryInterface (controller4.resetAndGetPointerAddress());
            if (controller4 != nullptr)
                controller4->put_AllowExternalDrop (FALSE);
        }

]=])
string(FIND "${_src}" "${_oldDrop}" _at)
if(NOT _at EQUAL -1)
  string(REPLACE "${_oldDrop}" "" _src "${_src}")
  set(_changed TRUE)
  message(STATUS "Removed the old set.Line AllowExternalDrop patch from JUCE")
endif()

if(NOT _src MATCHES "setline: dropped file paths")
  set(_anchor [=[                                                     if (const auto str = callMethodWithLpwstrResult (args, &ICoreWebView2WebMessageReceivedEventArgs::TryGetWebMessageAsString))
                                                         owner.impl->handleNativeEvent (JSON::fromString (*str));]=])
  string(FIND "${_src}" "${_anchor}" _at)
  if(_at EQUAL -1)
    message(FATAL_ERROR "PatchJuce.cmake: WebMessageReceived handler not found in ${_f} (JUCE version changed?)")
  endif()
  set(_new [=[                                                     if (const auto str = callMethodWithLpwstrResult (args, &ICoreWebView2WebMessageReceivedEventArgs::TryGetWebMessageAsString))
                                                     {
                                                         auto message = JSON::fromString (*str);
                                                         { // setline: dropped file paths
                                                             ComSmartPtr<ICoreWebView2WebMessageReceivedEventArgs2> args2;
                                                             args->QueryInterface (args2.resetAndGetPointerAddress());
                                                             ComSmartPtr<ICoreWebView2ObjectCollectionView> objects;
                                                             if (args2 != nullptr && args2->get_AdditionalObjects (objects.resetAndGetPointerAddress()) == S_OK && objects != nullptr)
                                                             {
                                                                 UINT32 count = 0;
                                                                 objects->get_Count (&count);
                                                                 Array<var> paths;
                                                                 for (UINT32 i = 0; i < count; ++i)
                                                                 {
                                                                     ComSmartPtr<IUnknown> object;
                                                                     ComSmartPtr<ICoreWebView2File> file;
                                                                     if (objects->GetValueAtIndex (i, object.resetAndGetPointerAddress()) != S_OK || object == nullptr)
                                                                         continue;
                                                                     object->QueryInterface (file.resetAndGetPointerAddress());
                                                                     LPWSTR path = nullptr;
                                                                     if (file != nullptr && file->get_Path (&path) == S_OK && path != nullptr)
                                                                     {
                                                                         paths.add (String (path));
                                                                         CoTaskMemFree (path);
                                                                     }
                                                                 }
                                                                 if (auto* m = message.getDynamicObject())
                                                                     if (auto* payload = m->getProperty ("payload").getDynamicObject())
                                                                         payload->setProperty ("paths", paths);
                                                             }
                                                         }
                                                         owner.impl->handleNativeEvent (message);
                                                     }]=])
  string(REPLACE "${_anchor}" "${_new}" _src "${_src}")
  set(_changed TRUE)
  message(STATUS "Patched JUCE WebView2: dropped files reach the app with their paths")
endif()
if(_changed)
  file(WRITE "${_f}" "${_src}")
endif()

# ---- 2. Linear escaping ----
# set.Line: every native-function result and event goes through this escape. JUCE's String::replace
# rescans from the start for each match (UTF-8 indexing), so text full of backslashes or quotes (a
# session file sent as JSON) took O(n^2): ~23 s for 100 KB. Same output, done in one linear pass.
set(_f2 "${JUCE_SOURCE_DIR}/modules/juce_gui_extra/misc/juce_WebBrowserComponent.cpp")
file(READ "${_f2}" _src2)
set(_marker2 "setline: linear escape")
if(NOT _src2 MATCHES "${_marker2}")
  set(_old2 [=[        const auto escaped = objectAsString.replace ("\\", "\\\\").replace ("'", "\\'");]=])
  string(FIND "${_src2}" "${_old2}" _at2)
  if(_at2 EQUAL -1)
    message(FATAL_ERROR "PatchJuce.cmake: escape line not found in ${_f2} (JUCE version changed?)")
  endif()
  set(_new2 [=[        const auto escaped = [&objectAsString] { // setline: linear escape
            const auto in = objectAsString.toStdString();
            std::string out;
            out.reserve (in.size() + in.size() / 8 + 16);
            for (const char c : in)
            {
                if (c == '\\') out += "\\\\";
                else if (c == '\'') out += "\\'";
                else out += c;
            }
            return String::fromUTF8 (out.data(), (int) out.size());
        }();]=])
  string(REPLACE "${_old2}" "${_new2}" _src2 "${_src2}")
  file(WRITE "${_f2}" "${_src2}")
  message(STATUS "Patched JUCE WebBrowserComponent: linear escaping of results sent to the page")
endif()
