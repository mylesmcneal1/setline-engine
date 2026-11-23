# Building the set.Line desktop app

The `setline` target is the desktop app: a native window (JUCE) hosting the web UI in `ui/`
(WebView2 on Windows, WKWebView on macOS). It builds alongside `setline-spike` and the core tests.

## Needs

- Everything in the README's build section (CMake, a C++17 compiler, Git).
- **Node.js + npm** — the build runs `npm ci` and `npm run build` in `ui/` (Vite + TypeScript)
  and embeds `ui/dist` in the app.
- **Windows: the WebView2 SDK** (NuGet package `Microsoft.Web.WebView2`, linked statically).
  JUCE finds it in the user's NuGet folder. Install it once from PowerShell:
  ```
  Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force
  Register-PackageSource -provider NuGet -name nugetRepository -location https://www.nuget.org/api/v2 -Force
  Install-Package Microsoft.Web.WebView2 -Scope CurrentUser -RequiredVersion 1.0.3485.44 -Source nugetRepository -Force
  ```
  (or pass `-DJUCE_WEBVIEW2_PACKAGE_LOCATION=<folder containing Microsoft.Web.WebView2.*>`).
  Users need the WebView2 runtime, which ships with Windows 10/11.

## Build

```
cmake -B build-asio -G Ninja -DCMAKE_BUILD_TYPE=Release -DSETLINE_ASIO_SDK_DIR="C:/SDKs/asiosdk"
cmake --build build-asio
build-asio\setline_artefacts\Release\set.Line.exe
```

Leave out `-DSETLINE_ASIO_SDK_DIR` for a WASAPI-only build. `-DSETLINE_WITH_GUI=OFF` skips the app.

## Working on the UI

```
cd ui
npm run dev                      # Vite on http://localhost:5173
set.Line.exe --dev               # the app loads the pages from Vite (live reload)
```

The pages also open in a normal browser at http://localhost:5173/1-arrange.html. There's no
native bridge there, so they keep the mockups' in-browser behaviour (JS timer, WebAudio click).

`ui-mockups/` is the approved design and stays untouched; `ui/` is the working copy.
