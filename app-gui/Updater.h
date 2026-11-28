#pragma once
// 8d: in-app updates, the way setline-update does them, without Terminal. The "latest" release of the repository
// (published by CI after every green build) is checked, its zip downloaded and its SHA-256 verified against the
// release's SHA256SUMS.txt; the new app is unpacked next to the installed one, then a small script (started detached)
// waits for set.Line to quit, keeps the old app as "set.Line (previous)" (Roll back swaps them again) and relaunches.
// The network and file work runs on the caller's thread (Bridge puts it on its own thread).
#include <juce_core/juce_core.h>
#include <functional>

namespace setline::gui::updater {

inline const char* kRepo = "mylesmcneal1/setline-engine";

// "0.1.61", "set.Line 0.1.61" -> compare as numbers (-1, 0, 1)
int compareVersions(const juce::String& a, const juce::String& b);
juce::String versionIn(const juce::String& text); // the first "N.N.N" in text, or ""

// This platform's asset: set.Line-macos.zip / set.Line-windows.zip
juce::String assetName();
// The installed app: the .app bundle (Mac) or the folder holding set.Line.exe (Windows); its "(previous)" sibling.
juce::File currentApp();
juce::File previousApp(const juce::File& app);
// Why this copy can't be updated in place ("" = it can): a dev build, a folder we can't write...
juce::String cantInstall(const juce::File& app, const juce::String& runningVersion);

// {version, title, notes, asset: {name, url, size}, sums: {url}} of the latest release, or error set
// 15 §13: status: GitHub's HTTP status (401 / 403 / 404: a private repository needs a token, or the token is wrong)
juce::var fetchLatest(const juce::String& token, juce::String& error, int* status = nullptr);
// Downloads url to file (progress 0..1); false + error on failure. With a token (a private repository's asset), the
// token goes only to GitHub's API; the signed download it redirects to is fetched without it.
bool download(const juce::String& url, const juce::String& token, const juce::File& to, std::function<void(double)> progress, juce::String& error);
// The file's SHA-256 matches its line in SHA256SUMS.txt
bool verify(const juce::File& file, const juce::String& sumsText, const juce::String& name, juce::String& error);
// Unpacks the zip next to app as "<name> (update)" (Mac: ditto, keeps permissions and links). -> the staged app.
juce::File stage(const juce::File& zip, const juce::File& app, juce::String& error);
// The script that swaps the apps once process pid has gone: install (staged -> app, app -> previous) or rollback
// (app <-> previous); relaunch: open the result. Written to dir; -> the script file.
juce::File writeSwapScript(const juce::File& dir, bool rollback, const juce::File& app, const juce::File& staged, int pid, bool relaunch);
int currentPid();
// Starts the script detached (it outlives set.Line); wait = run it and wait (tests)
bool runScript(const juce::File& script, bool wait);

// --update-test <dir>: version compare, checksum verify (good / damaged), stage + install + rollback swaps on fake
// apps in dir. Lines "ok ..." / "FAIL ...", last "UPDATE OK" / "UPDATE FAILED".
juce::StringArray selfTest(const juce::File& dir);

} // namespace setline::gui::updater
