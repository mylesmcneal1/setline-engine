# ONNX Runtime for the built-in Kokoro cue voices (step 2, phase 7).
#
# Pinned to 1.19.2 on purpose: it is the newest release that still runs on Intel Macs and on macOS 12
# (the 2015 MacBook Pro). 1.20-1.23 need macOS 13.3+, and 1.24+ ship for Apple Silicon only (macOS 14+).
# See THIRD_PARTY.md before changing it.
#
# The official NuGet package is downloaded once and checked against the SHA-512 nuget.org publishes for
# it (the build stops on a mismatch). Only the C API header is compiled in; the library itself is copied
# next to the app and loaded at run time, the first time a voice is rendered (app-gui/Ort.cpp), so the
# app still opens where it can't load.
#
# Sets: SETLINE_ORT_INCLUDE_DIR, and setline_add_onnxruntime(<target>) copies the library into the app.

set(SETLINE_ORT_VERSION "1.19.2")
set(SETLINE_ORT_SHA512 "683cd46057bef66d8eca32d713241f2f0de4306074094592b9348868d18ebb29b21b9bb5d9466a9d27422b52163f8ca02f3eb1f4f16d21740f704d2c8058f6e4")
set(SETLINE_DOWNLOADS_DIR "${CMAKE_BINARY_DIR}/_downloads" CACHE PATH "Where pinned third-party downloads are kept (CI caches it)")

set(_ort_pkg "${SETLINE_DOWNLOADS_DIR}/microsoft.ml.onnxruntime.${SETLINE_ORT_VERSION}.nupkg")
set(_ort_dir "${CMAKE_BINARY_DIR}/_deps/onnxruntime-${SETLINE_ORT_VERSION}")

if(EXISTS "${_ort_pkg}")
  file(SHA512 "${_ort_pkg}" _ort_have)
  if(NOT _ort_have STREQUAL SETLINE_ORT_SHA512)
    message(STATUS "set.Line: ONNX Runtime package doesn't match its SHA-512; downloading it again")
    file(REMOVE "${_ort_pkg}")
  endif()
endif()
if(NOT EXISTS "${_ort_pkg}")
  message(STATUS "set.Line: downloading ONNX Runtime ${SETLINE_ORT_VERSION} (about 110 MB, once)")
  file(DOWNLOAD
    "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${SETLINE_ORT_VERSION}/microsoft.ml.onnxruntime.${SETLINE_ORT_VERSION}.nupkg"
    "${_ort_pkg}.part"
    EXPECTED_HASH SHA512=${SETLINE_ORT_SHA512}
    TLS_VERIFY ON
    STATUS _ort_status)
  list(GET _ort_status 0 _ort_code)
  if(NOT _ort_code EQUAL 0)
    file(REMOVE "${_ort_pkg}.part")
    message(FATAL_ERROR "set.Line: couldn't download ONNX Runtime ${SETLINE_ORT_VERSION}: ${_ort_status}")
  endif()
  file(RENAME "${_ort_pkg}.part" "${_ort_pkg}")
endif()
message(STATUS "set.Line: ONNX Runtime ${SETLINE_ORT_VERSION} package verified (SHA-512)")

if(NOT EXISTS "${_ort_dir}/.extracted")
  file(REMOVE_RECURSE "${_ort_dir}")
  file(ARCHIVE_EXTRACT INPUT "${_ort_pkg}" DESTINATION "${_ort_dir}"
    PATTERNS "build/native/include/*" "runtimes/win-x64/native/onnxruntime.dll"
             "runtimes/osx-x64/native/*" "runtimes/osx-arm64/native/*" "LICENSE" "ThirdPartyNotices.txt")
  file(WRITE "${_ort_dir}/.extracted" "${SETLINE_ORT_VERSION}")
endif()
set(SETLINE_ORT_INCLUDE_DIR "${_ort_dir}/build/native/include")

# The library for this build: Windows x64, or the Mac slices this build targets (lipo'd for universal).
if(WIN32)
  set(SETLINE_ORT_LIB "${_ort_dir}/runtimes/win-x64/native/onnxruntime.dll")
  set(SETLINE_ORT_LIB_NAME "onnxruntime.dll")
elseif(APPLE)
  set(SETLINE_ORT_LIB_NAME "libonnxruntime.${SETLINE_ORT_VERSION}.dylib")
  set(_archs "${CMAKE_OSX_ARCHITECTURES}")
  if(NOT _archs)
    set(_archs "${CMAKE_HOST_SYSTEM_PROCESSOR}")
  endif()
  set(_slices "")
  foreach(_a IN LISTS _archs)
    if(_a STREQUAL "arm64")
      list(APPEND _slices "${_ort_dir}/runtimes/osx-arm64/native/libonnxruntime.dylib")
    else()
      list(APPEND _slices "${_ort_dir}/runtimes/osx-x64/native/libonnxruntime.dylib")
    endif()
  endforeach()
  list(LENGTH _slices _n)
  if(_n GREATER 1)
    set(SETLINE_ORT_LIB "${_ort_dir}/universal/${SETLINE_ORT_LIB_NAME}")
    if(NOT EXISTS "${SETLINE_ORT_LIB}")
      file(MAKE_DIRECTORY "${_ort_dir}/universal")
      execute_process(COMMAND lipo -create ${_slices} -output "${SETLINE_ORT_LIB}" RESULT_VARIABLE _lipo)
      if(NOT _lipo EQUAL 0)
        message(FATAL_ERROR "set.Line: lipo couldn't combine the ONNX Runtime libraries")
      endif()
    endif()
  else()
    list(GET _slices 0 SETLINE_ORT_LIB)
  endif()
endif()

function(setline_add_onnxruntime target)
  target_include_directories(${target} PRIVATE "${SETLINE_ORT_INCLUDE_DIR}")
  target_compile_definitions(${target} PRIVATE
    SETLINE_ORT_VERSION="${SETLINE_ORT_VERSION}" SETLINE_ORT_LIB_NAME="${SETLINE_ORT_LIB_NAME}")
  if(WIN32)
    set(_dest "$<TARGET_FILE_DIR:${target}>")
    set(_lic "$<TARGET_FILE_DIR:${target}>/licenses")
  else()
    set(_dest "$<TARGET_BUNDLE_CONTENT_DIR:${target}>/Frameworks")
    set(_lic "$<TARGET_BUNDLE_CONTENT_DIR:${target}>/Resources/licenses")
  endif()
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${_dest}" "${_lic}"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${SETLINE_ORT_LIB}" "${_dest}/${SETLINE_ORT_LIB_NAME}"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${_ort_dir}/LICENSE" "${_lic}/onnxruntime-LICENSE.txt"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${_ort_dir}/ThirdPartyNotices.txt" "${_lic}/onnxruntime-ThirdPartyNotices.txt"
    VERBATIM)
endfunction()
