# set.Line: one small, idempotent change to JUCE's WebView2 backend.
#
# WebView2 swallows files dropped on it and only hands the page File objects without paths,
# so set.Line turns WebView2's own drop handling off. Drops then reach the JUCE window,
# which is a FileDragAndDropTarget and passes the real paths to the page (app-gui/Main.cpp).
# Runs at configure time on the fetched JUCE sources (or FETCHCONTENT_SOURCE_DIR_JUCE).
set(_f "${JUCE_SOURCE_DIR}/modules/juce_gui_extra/native/juce_WebBrowserComponent_windows.cpp")
file(READ "${_f}" _src)
set(_marker "setline: AllowExternalDrop")
if(NOT _src MATCHES "${_marker}")
  set(_anchor "        ComSmartPtr<ICoreWebView2Settings> settings;\n        webView->get_Settings (settings.resetAndGetPointerAddress());")
  string(FIND "${_src}" "${_anchor}" _at)
  if(_at EQUAL -1)
    message(FATAL_ERROR "PatchJuce.cmake: anchor not found in ${_f} (JUCE version changed?)")
  endif()
  set(_add "        { // ${_marker}\n            ComSmartPtr<ICoreWebView2Controller4> controller4;\n            webViewController->QueryInterface (controller4.resetAndGetPointerAddress());\n            if (controller4 != nullptr)\n                controller4->put_AllowExternalDrop (FALSE);\n        }\n\n")
  string(REPLACE "${_anchor}" "${_add}${_anchor}" _src "${_src}")
  file(WRITE "${_f}" "${_src}")
  message(STATUS "Patched JUCE WebView2: external drops go to the host window")
endif()

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
