cmake_minimum_required(VERSION 3.22)

# A 2015 MacBook Pro runs up to macOS 12, so target 10.15+ (needed for std::filesystem).
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Oldest macOS supported")

project(SetLineEngineSpike VERSION 0.1.0 LANGUAGES C CXX)

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
  # downloaded automatically, so point this at your unzipped copy to enable it:
  #   cmake -B build -DSETLINE_ASIO_SDK_DIR="C:/SDKs/asiosdk_2.3.3"
  # Without it the Windows build still runs on WASAPI (shared, exclusive, low-latency modes).
  set(SETLINE_ASIO_SDK_DIR "" CACHE PATH "Folder of the Steinberg ASIO SDK (Windows only)")
  if(WIN32 AND SETLINE_ASIO_SDK_DIR)
    if(NOT EXISTS "${SETLINE_ASIO_SDK_DIR}/common/iasiodrv.h")
      message(FATAL_ERROR "SETLINE_ASIO_SDK_DIR doesn't look like the ASIO SDK (no common/iasiodrv.h)")
    endif()
    target_include_directories(setline-spike PRIVATE "${SETLINE_ASIO_SDK_DIR}/common")
    target_compile_definitions(setline-spike PRIVATE JUCE_ASIO=1)
    message(STATUS "set.Line: ASIO enabled")
  endif()
endif()
