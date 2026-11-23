# Builds the web UI (ui/ -> ui/dist with Vite) and packs ui/dist into one zip for juce_add_binary_data.
# Run as: cmake -DNPM=<npm> -DUI_DIR=<ui> -DOUT=<zip> -P BuildUi.cmake
foreach(v NPM UI_DIR OUT)
  if(NOT ${v})
    message(FATAL_ERROR "BuildUi.cmake: ${v} not set")
  endif()
endforeach()

# Install packages when node_modules is missing or older than the lockfile.
set(stamp "${UI_DIR}/node_modules/.setline-stamp")
if(NOT EXISTS "${stamp}" OR "${UI_DIR}/package-lock.json" IS_NEWER_THAN "${stamp}")
  message(STATUS "set.Line UI: npm ci")
  execute_process(COMMAND "${NPM}" ci --no-audit --no-fund WORKING_DIRECTORY "${UI_DIR}" RESULT_VARIABLE r)
  if(NOT r EQUAL 0)
    message(FATAL_ERROR "npm ci failed (${r})")
  endif()
  file(TOUCH "${stamp}")
endif()

message(STATUS "set.Line UI: npm run build")
execute_process(COMMAND "${NPM}" run build WORKING_DIRECTORY "${UI_DIR}" RESULT_VARIABLE r)
if(NOT r EQUAL 0)
  message(FATAL_ERROR "npm run build failed (${r})")
endif()

file(GLOB_RECURSE files RELATIVE "${UI_DIR}/dist" "${UI_DIR}/dist/*")
if(NOT files)
  message(FATAL_ERROR "ui/dist is empty after the build")
endif()
file(REMOVE "${OUT}")
execute_process(COMMAND "${CMAKE_COMMAND}" -E tar cf "${OUT}" --format=zip -- ${files}
                WORKING_DIRECTORY "${UI_DIR}/dist" RESULT_VARIABLE r)
if(NOT r EQUAL 0)
  message(FATAL_ERROR "zipping ui/dist failed (${r})")
endif()
list(LENGTH files n)
message(STATUS "set.Line UI: packed ${n} files into ${OUT}")
