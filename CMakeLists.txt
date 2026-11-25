cmake_minimum_required(VERSION 3.22)

# A 2015 MacBook Pro runs up to macOS 12, so target 10.15+ (needed for std::filesystem).
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Oldest macOS supported")

# Every CI build is 0.1.<run number> (shown as "Beta 0.1.<n>"); a local build is 0.1.0 ("dev build").
set(SETLINE_BUILD_NUMBER "0" CACHE STRING "Build number (CI: github.run_number)")
project(SetLineEngineSpike VERSION 0.1.${SETLINE_BUILD_NUMBER} LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

option(SETLINE_WITH_JUCE "Build the JUCE command-line app (downloads JUCE)" ON)
find_package(Threads REQUIRED)

# ---------------------------------------------------------------- core (plain C++, no JUCE)
add_library(setline_core STATIC
  core/Engine.cpp
  core/Platform.cpp
  core/TestSong.cpp)
target_include_directories(setline_core PUBLIC core)
target_link_libraries(setline_core PUBLIC Threads::Threads)
if(WIN32)
  target_link_libraries(setline_core PUBLIC winmm avrt)
endif()
if(MSVC)
  target_compile_definitions(setline_core PUBLIC _CRT_SECURE_NO_WARNINGS NOMINMAX)
endif()

add_executable(setline-core-test tests/core_test.cpp)
target_link_libraries(setline-core-test PRIVATE setline_core)

enable_testing()
add_test(NAME core COMMAND setline-core-test)

# ---------------------------------------------------------------- app (JUCE: device, MIDI ports, files)
if(SETLINE_WITH_JUCE)
  include(FetchContent)
  set(SETLINE_JUCE_TAG "8.0.14" CACHE STRING "JUCE release tag to build against")
  FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        ${SETLINE_JUCE_TAG}
    GIT_SHALLOW    TRUE)
  FetchContent_MakeAvailable(JUCE)
  # Sources are compiled at build time, so patching after add_subdirectory is fine.
  set(JUCE_SOURCE_DIR "${juce_SOURCE_DIR}")
  include(cmake/PatchJuce.cmake)

  juce_add_console_app(setline-spike PRODUCT_NAME "setline-spike")
  target_sources(setline-spike PRIVATE app/Main.cpp)
  target_compile_definitions(setline-spike PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_USE_FLAC=1
    JUCE_USE_OGGVORBIS=0
    JUCE_USE_MP3AUDIOFORMAT=0)
  target_link_libraries(setline-spike
    PRIVATE setline_core juce::juce_audio_devices juce::juce_audio_formats
    PUBLIC  juce::juce_recommended_config_flags)

  # Windows: ASIO is how most pro interfaces reach low latency. Steinberg's SDK can't be
  # downloaded automatically, so point this at your unzipped copy to enable it (both apps):
  #   cmake -B build -DSETLINE_ASIO_SDK_DIR="C:/SDKs/asiosdk"
  # Without it the Windows build still runs on WASAPI (shared, exclusive, low-latency modes).
  set(SETLINE_ASIO_SDK_DIR "" CACHE PATH "Folder of the Steinberg ASIO SDK (Windows only)")
  if(WIN32 AND SETLINE_ASIO_SDK_DIR)
    if(NOT EXISTS "${SETLINE_ASIO_SDK_DIR}/common/iasiodrv.h")
      message(FATAL_ERROR "SETLINE_ASIO_SDK_DIR doesn't look like the ASIO SDK (no common/iasiodrv.h)")
    endif()
    message(STATUS "set.Line: ASIO enabled")
  endif()
  function(setline_enable_asio target)
    if(WIN32 AND SETLINE_ASIO_SDK_DIR)
      target_include_directories(${target} PRIVATE "${SETLINE_ASIO_SDK_DIR}/common")
      target_compile_definitions(${target} PRIVATE JUCE_ASIO=1)
    endif()
  endfunction()
  setline_enable_asio(setline-spike)

  # ---------------------------------------------------------------- set.Line desktop app (GUI)
  # A native window hosting the web UI in ui/ (WebView2 on Windows, WKWebView on macOS).
  # Needs Node.js + npm (to build ui/ with Vite) and, on Windows, the WebView2 NuGet package
  # (see docs/building-the-app.md).
  option(SETLINE_WITH_GUI "Build the set.Line desktop app" ON)
  if(SETLINE_WITH_GUI)
    find_program(SETLINE_NPM NAMES npm.cmd npm REQUIRED)
    set(SETLINE_UI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/ui")
    set(SETLINE_UI_ZIP "${CMAKE_CURRENT_BINARY_DIR}/setline-ui.zip")
    file(GLOB SETLINE_UI_INPUTS CONFIGURE_DEPENDS
      "${SETLINE_UI_DIR}/*.html" "${SETLINE_UI_DIR}/public/*" "${SETLINE_UI_DIR}/src/*" "${SETLINE_UI_DIR}/src/*/*"
      "${SETLINE_UI_DIR}/package.json" "${SETLINE_UI_DIR}/package-lock.json"
      "${SETLINE_UI_DIR}/vite.config.ts" "${SETLINE_UI_DIR}/tsconfig.json")
    add_custom_command(OUTPUT "${SETLINE_UI_ZIP}"
      COMMAND "${CMAKE_COMMAND}" -DNPM=${SETLINE_NPM} -DUI_DIR=${SETLINE_UI_DIR} -DOUT=${SETLINE_UI_ZIP}
              -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildUi.cmake"
      DEPENDS ${SETLINE_UI_INPUTS} "${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildUi.cmake"
      COMMENT "Building the web UI (Vite)"
      VERBATIM)
    juce_add_binary_data(setline_ui NAMESPACE SetLineUi HEADER_NAME SetLineUi.h SOURCES "${SETLINE_UI_ZIP}")
    # The approved brand files the loading window draws, as they are (assets/brand).
    juce_add_binary_data(setline_brand NAMESPACE SetLineBrand HEADER_NAME SetLineBrand.h SOURCES
      "${CMAKE_CURRENT_SOURCE_DIR}/assets/brand/setline-icon.svg"
      "${CMAKE_CURRENT_SOURCE_DIR}/assets/brand/setline-wordmark-text-only.svg")

    # App icons, from the approved files (docs/branding-and-loading.md):
    # - Windows: assets/brand/setline.ico (all sizes, 16-256) as the .exe's icon resource; the window, taskbar,
    #   Start menu and Explorer all take it from there.
    # - macOS: setline.icns built with iconutil from png/mac-*.png (the committed .icns lacks the 16 and 32 px
    #   sizes), copied into the bundle's Resources and named in Info.plist.
    set(SETLINE_PLIST_EXTRA "")
    if(APPLE)
      set(_iconset "${CMAKE_CURRENT_BINARY_DIR}/setline.iconset")
      set(SETLINE_ICNS "${CMAKE_CURRENT_BINARY_DIR}/setline.icns")
      file(MAKE_DIRECTORY "${_iconset}")
      set(_b "${CMAKE_CURRENT_SOURCE_DIR}/assets/brand/png")
      foreach(_pair "16;icon_16x16" "32;icon_16x16@2x" "32;icon_32x32" "64;icon_32x32@2x" "128;icon_128x128"
                    "256;icon_128x128@2x" "256;icon_256x256" "512;icon_256x256@2x" "512;icon_512x512" "1024;icon_512x512@2x")
        list(GET _pair 0 _size)
        list(GET _pair 1 _name)
        configure_file("${_b}/mac-${_size}.png" "${_iconset}/${_name}.png" COPYONLY)
      endforeach()
      execute_process(COMMAND iconutil -c icns "${_iconset}" -o "${SETLINE_ICNS}" RESULT_VARIABLE _iconutil)
      if(NOT _iconutil EQUAL 0)
        message(WARNING "set.Line: iconutil failed; using the committed setline.icns")
        set(SETLINE_ICNS "${CMAKE_CURRENT_SOURCE_DIR}/assets/brand/setline.icns")
      endif()
      set(SETLINE_PLIST_EXTRA "<plist><dict><key>CFBundleIconFile</key><string>setline</string></dict></plist>")
    endif()

    juce_add_gui_app(setline
      PRODUCT_NAME "set.Line"
      COMPANY_NAME "set.Line"
      BUNDLE_ID "app.setline.desktop"
      VERSION ${PROJECT_VERSION}
      PLIST_TO_MERGE "${SETLINE_PLIST_EXTRA}"
      NEEDS_WEBVIEW2 TRUE)
    if(WIN32)
      target_sources(setline PRIVATE app-gui/setline.rc)
    elseif(APPLE)
      target_sources(setline PRIVATE "${SETLINE_ICNS}")
      set_source_files_properties("${SETLINE_ICNS}" PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
    endif()
    target_sources(setline PRIVATE
      app-gui/Main.cpp
      app-gui/AudioHost.cpp
      app-gui/Bridge.cpp
      app-gui/SongMapper.cpp
      app-gui/SessionFile.cpp
      app-gui/Media.cpp
      app-gui/Peaks.cpp
      app-gui/Cues.cpp
      app-gui/Splash.cpp
      app-gui/Log.cpp
      app-gui/Folders.cpp
      app-gui/Kokoro.cpp
      app-gui/Ort.cpp
      app-gui/SpeechWin.cpp
      app-gui/WebUi.cpp
      app-gui/WinIcon.cpp)
    if(APPLE)
      target_sources(setline PRIVATE app-gui/MacDrop.mm app-gui/SpeechMac.mm)
      # Objective-C++ without changing how JUCE's own sources compile.
      set_source_files_properties(app-gui/MacDrop.mm app-gui/SpeechMac.mm PROPERTIES COMPILE_OPTIONS "-xobjective-c++")
    endif()
    target_compile_definitions(setline PRIVATE
      JUCE_WEB_BROWSER=1
      JUCE_USE_CURL=0
      JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
      JUCE_USE_FLAC=1
      JUCE_USE_OGGVORBIS=0
      JUCE_USE_MP3AUDIOFORMAT=0
      JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:setline,JUCE_PRODUCT_NAME>"
      JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:setline,JUCE_VERSION>")
    target_link_libraries(setline
      PRIVATE setline_core setline_ui setline_brand
              juce::juce_gui_extra juce::juce_audio_devices juce::juce_audio_formats juce::juce_cryptography
      PUBLIC  juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    setline_enable_asio(setline)
    # Built-in Kokoro cue voices: ONNX Runtime 1.19.2, verified and copied next to the app (cmake/OnnxRuntime.cmake).
    include(cmake/OnnxRuntime.cmake)
    setline_add_onnxruntime(setline)
    if(MSVC) # Kokoro.cpp spells phonemes in UTF-8 (ˈ ɹ ə...); MSVC reads sources as the system code page otherwise
      set_source_files_properties(app-gui/Kokoro.cpp PROPERTIES COMPILE_OPTIONS "/utf-8")
    endif()
    # Spoken cues: the system's speech (SAPI on Windows, AVSpeechSynthesizer on macOS).
    if(WIN32)
      target_link_libraries(setline PRIVATE sapi ole32 normaliz)
    elseif(APPLE)
      target_link_libraries(setline PRIVATE "-framework AVFoundation")
    endif()
  endif()
endif()
