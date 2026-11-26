#include "Updater.h"
#include <juce_cryptography/juce_cryptography.h>
#if JUCE_WINDOWS
 #include <windows.h>
#else
 #include <unistd.h>
#endif

namespace setline::gui::updater {

juce::String versionIn(const juce::String& text)
{
    for (int i = 0; i < text.length(); ++i) {
        if (! juce::CharacterFunctions::isDigit(text[i]) || (i > 0 && (juce::CharacterFunctions::isDigit(text[i - 1]) || text[i - 1] == '.'))) continue;
        int j = i, dots = 0;
        while (j < text.length() && (juce::CharacterFunctions::isDigit(text[j]) || (text[j] == '.' && j + 1 < text.length() && juce::CharacterFunctions::isDigit(text[j + 1])))) { dots += text[j] == '.'; ++j; }
        if (dots >= 2) return text.substring(i, j);
    }
    return {};
}

int compareVersions(const juce::String& a, const juce::String& b)
{
    juce::StringArray x, y; x.addTokens(versionIn(a).isNotEmpty() ? versionIn(a) : a, ".", ""); y.addTokens(versionIn(b).isNotEmpty() ? versionIn(b) : b, ".", "");
    for (int i = 0; i < juce::jmax(x.size(), y.size()); ++i) { const int p = x[i].getIntValue(), q = y[i].getIntValue(); if (p != q) return p < q ? -1 : 1; }
    return 0;
}

juce::String assetName()
{
   #if JUCE_MAC
    return "set.Line-macos.zip";
   #else
    return "set.Line-windows.zip";
   #endif
}

juce::File currentApp()
{
    auto f = juce::File::getSpecialLocation(juce::File::currentApplicationFile);
   #if JUCE_MAC
    return f; // the .app bundle
   #else
    return f.getParentDirectory(); // the folder with set.Line.exe and its DLLs
   #endif
}

juce::File previousApp(const juce::File& app)
{
    const auto name = app.getFileNameWithoutExtension() + " (previous)" + app.getFileExtension();
    return app.getParentDirectory().getChildFile(name);
}

juce::String cantInstall(const juce::File& app, const juce::String& runningVersion)
{
    if (runningVersion.endsWith(".0")) return "This is a development build (" + runningVersion + "); install the release to get updates.";
   #if JUCE_MAC
    if (! app.hasFileExtension("app")) return "set.Line isn't running from its .app.";
   #else
    if (! app.getChildFile("set.Line.exe").existsAsFile()) return "set.Line.exe isn't in its folder.";
   #endif
    if (! app.getParentDirectory().hasWriteAccess()) return "set.Line can't write to " + app.getParentDirectory().getFullPathName() + ". Use an administrator account, or install set.Line in a folder you can write to.";
    return {};
}

namespace {
juce::URL api(const juce::String& path) { return juce::URL("https://api.github.com/repos/" + juce::String(kRepo) + path); }
juce::String headers(const juce::String& token, const juce::String& accept)
{
    juce::String h = "User-Agent: set.Line-updater\r\nAccept: " + accept + "\r\nX-GitHub-Api-Version: 2022-11-28\r\n";
    if (token.isNotEmpty()) h += "Authorization: Bearer " + token + "\r\n";
    return h;
}
}

juce::var fetchLatest(const juce::String& token, juce::String& error)
{
    int status = 0;
    auto in = api("/releases/tags/latest").createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
        .withExtraHeaders(headers(token, "application/vnd.github+json")).withConnectionTimeoutMs(10000).withStatusCode(&status).withNumRedirectsToFollow(5));
    if (! in) { error = "Can't reach GitHub. Check the internet connection."; return {}; }
    const auto text = in->readEntireStreamAsString();
    if (status == 404) { error = token.isEmpty() ? "No release found. If the repository is private, add an access token in Settings › General." : "No \"latest\" release found."; return {}; }
    if (status == 401 || status == 403) { error = "GitHub refused the request (" + juce::String(status) + "). Check the access token in Settings › General."; return {}; }
    const auto j = juce::JSON::parse(text);
    if (! j.isObject()) { error = "GitHub's answer wasn't readable."; return {}; }
    auto* o = new juce::DynamicObject(); juce::var r(o);
    o->setProperty("title", j["name"]);
    o->setProperty("version", versionIn(j["name"].toString()));
    o->setProperty("notes", j["body"]);
    o->setProperty("published", j["published_at"]);
    if (auto* assets = j["assets"].getArray())
        for (auto& a : *assets) {
            const auto name = a["name"].toString();
            // public: the browser URL; private (token): the API URL with Accept: application/octet-stream
            const auto url = token.isNotEmpty() ? a["url"].toString() : a["browser_download_url"].toString();
            auto* x = new juce::DynamicObject(); x->setProperty("name", name); x->setProperty("url", url); x->setProperty("size", a["size"]);
            if (name == assetName()) o->setProperty("asset", juce::var(x));
            else if (name == "SHA256SUMS.txt") o->setProperty("sums", juce::var(x));
            else delete x;
        }
    if (! r["asset"].isObject() || ! r["sums"].isObject()) { error = "The latest release has no " + assetName() + " or SHA256SUMS.txt yet."; return {}; }
    return r;
}

bool download(const juce::String& url, const juce::String& token, const juce::File& to, std::function<void(double)> progress, juce::String& error)
{
    int status = 0;
    juce::StringPairArray resp;
    auto in = juce::URL(url).createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
        .withExtraHeaders(headers(token, "application/octet-stream")).withConnectionTimeoutMs(15000).withStatusCode(&status).withNumRedirectsToFollow(8).withResponseHeaders(&resp));
    if (! in || status >= 400) { error = "The download failed" + (status ? " (" + juce::String(status) + ")" : juce::String()) + ". Check the internet connection."; return false; }
    to.getParentDirectory().createDirectory();
    to.deleteFile();
    juce::FileOutputStream out(to);
    if (! out.openedOk()) { error = "Can't write " + to.getFullPathName(); return false; }
    const auto total = in->getTotalLength();
    juce::HeapBlock<char> buf(1 << 16);
    juce::int64 done = 0;
    for (;;) {
        const int n = in->read(buf, 1 << 16);
        if (n <= 0) break;
        out.write(buf, (size_t) n); done += n;
        if (progress && total > 0) progress((double) done / (double) total);
    }
    out.flush();
    if (total > 0 && done != total) { error = "The download stopped before the end."; return false; }
    return true;
}

bool verify(const juce::File& file, const juce::String& sumsText, const juce::String& name, juce::String& error)
{
    juce::String want;
    for (auto& line : juce::StringArray::fromLines(sumsText)) {
        const auto l = line.trim();
        if (l.endsWith(" " + name) || l.endsWith("*" + name)) { want = l.upToFirstOccurrenceOf(" ", false, false).trim().toLowerCase(); break; }
    }
    if (want.length() != 64) { error = "SHA256SUMS.txt has no checksum for " + name + "."; return false; }
    juce::FileInputStream in(file);
    if (! in.openedOk()) { error = "Can't read the download."; return false; }
    const auto got = juce::SHA256(in).toHexString().toLowerCase();
    if (got != want) { error = "The download is damaged or incomplete (its SHA-256 doesn't match); nothing was installed. Try again."; return false; }
    return true;
}

juce::File stage(const juce::File& zip, const juce::File& app, juce::String& error)
{
    const auto staged = app.getParentDirectory().getChildFile(app.getFileNameWithoutExtension() + " (update)" + app.getFileExtension());
    const auto tmp = app.getParentDirectory().getChildFile(".set.Line-update-unpack");
    staged.deleteRecursively(); tmp.deleteRecursively(); tmp.createDirectory();
   #if JUCE_MAC
    juce::ChildProcess p;
    if (! p.start(juce::StringArray { "/usr/bin/ditto", "-x", "-k", zip.getFullPathName(), tmp.getFullPathName() }) || ! p.waitForProcessToFinish(120000) || p.getExitCode() != 0) { error = "Couldn't unpack the update."; tmp.deleteRecursively(); return {}; }
    const auto got = tmp.getChildFile("set.Line.app");
    if (! got.isDirectory()) { error = "The update doesn't contain set.Line.app."; tmp.deleteRecursively(); return {}; }
    juce::ChildProcess x; if (x.start(juce::StringArray { "/usr/bin/xattr", "-dr", "com.apple.quarantine", got.getFullPathName() })) x.waitForProcessToFinish(20000);
   #else
    juce::ZipFile z(zip);
    if (z.getNumEntries() == 0 || z.uncompressTo(tmp, true).failed()) { error = "Couldn't unpack the update."; tmp.deleteRecursively(); return {}; }
    auto got = tmp;
    if (! got.getChildFile("set.Line.exe").existsAsFile()) { auto sub = tmp.findChildFiles(juce::File::findDirectories, false); if (sub.size() == 1 && sub[0].getChildFile("set.Line.exe").existsAsFile()) got = sub[0]; }
    if (! got.getChildFile("set.Line.exe").existsAsFile()) { error = "The update doesn't contain set.Line.exe."; tmp.deleteRecursively(); return {}; }
   #endif
    if (! got.moveFileTo(staged)) { error = "Couldn't put the update next to set.Line."; tmp.deleteRecursively(); return {}; }
    tmp.deleteRecursively();
    return staged;
}

juce::File writeSwapScript(const juce::File& dir, bool rollback, const juce::File& app, const juce::File& staged, int pid, bool relaunch)
{
    dir.createDirectory();
    const auto prev = previousApp(app);
   #if JUCE_MAC
    auto q = [](const juce::File& f) { return "'" + f.getFullPathName().replace("'", "'\\''") + "'"; };
    juce::String s = "#!/bin/sh\n# set.Line " + juce::String(rollback ? "rollback" : "update") + " (written by set.Line; runs once set.Line has quit)\n";
    s << "i=0; while kill -0 " << pid << " 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done\n";
    s << "APP=" << q(app) << "; PREV=" << q(prev) << "\n";
    if (rollback) {
        s << "TMP=" << q(app.getParentDirectory().getChildFile(app.getFileNameWithoutExtension() + " (rollback).app")) << "\n";
        s << "[ -d \"$PREV\" ] || exit 1\nrm -rf \"$TMP\"\n[ -d \"$APP\" ] && mv \"$APP\" \"$TMP\"\nmv \"$PREV\" \"$APP\" || { [ -d \"$TMP\" ] && mv \"$TMP\" \"$APP\"; exit 1; }\n[ -d \"$TMP\" ] && mv \"$TMP\" \"$PREV\"\n";
    } else {
        s << "NEW=" << q(staged) << "\n[ -d \"$NEW\" ] || exit 1\nrm -rf \"$PREV\"\n[ -d \"$APP\" ] && mv \"$APP\" \"$PREV\"\nmv \"$NEW\" \"$APP\" || { [ -d \"$PREV\" ] && mv \"$PREV\" \"$APP\"; exit 1; }\n";
        s << "xattr -dr com.apple.quarantine \"$APP\" 2>/dev/null\n";
    }
    if (relaunch) s << "open \"$APP\"\n";
    const auto f = dir.getChildFile(rollback ? "rollback.sh" : "update.sh");
   #else
    auto q = [](const juce::File& f) { return "\"" + f.getFullPathName() + "\""; };
    juce::String s = "@echo off\r\nrem set.Line " + juce::String(rollback ? "rollback" : "update") + " (written by set.Line; runs once set.Line has quit)\r\n";
    s << "set n=0\r\n:wait\r\ntasklist /FI \"PID eq " << pid << "\" 2>nul | find \"" << pid << "\" >nul && (set /a n+=1 & ping -n 2 127.0.0.1 >nul & if !n! lss 60 goto wait)\r\n";
    s << "ping -n 2 127.0.0.1 >nul\r\n";
    if (rollback) {
        const auto tmp = app.getParentDirectory().getChildFile(app.getFileName() + " (rollback)");
        s << "if not exist " << q(prev) << " exit /b 1\r\nif exist " << q(tmp) << " rmdir /s /q " << q(tmp) << "\r\n";
        s << "move " << q(app) << " " << q(tmp) << " >nul\r\nmove " << q(prev) << " " << q(app) << " >nul || (move " << q(tmp) << " " << q(app) << " >nul & exit /b 1)\r\n";
        s << "move " << q(tmp) << " " << q(prev) << " >nul\r\n";
    } else {
        s << "if not exist " << q(staged) << " exit /b 1\r\nif exist " << q(prev) << " rmdir /s /q " << q(prev) << "\r\n";
        s << "move " << q(app) << " " << q(prev) << " >nul\r\nmove " << q(staged) << " " << q(app) << " >nul || (move " << q(prev) << " " << q(app) << " >nul & exit /b 1)\r\n";
    }
    if (relaunch) s << "start \"\" " << q(app.getChildFile("set.Line.exe")) << "\r\n";
    const auto f = dir.getChildFile(rollback ? "rollback.cmd" : "update.cmd");
   #endif
    f.replaceWithText(s, false, false, nullptr);
   #if JUCE_MAC
    f.setExecutePermission(true);
   #endif
    return f;
}

int currentPid()
{
   #if JUCE_WINDOWS
    return (int) GetCurrentProcessId();
   #else
    return (int) getpid();
   #endif
}

bool runScript(const juce::File& script, bool wait)
{
   #if JUCE_MAC
    if (wait) { juce::ChildProcess p; return p.start(juce::StringArray { "/bin/sh", script.getFullPathName() }) && p.waitForProcessToFinish(120000) && p.getExitCode() == 0; }
    // detached: nohup in the background, so it outlives set.Line
    juce::ChildProcess p;
    return p.start(juce::StringArray { "/bin/sh", "-c", "nohup /bin/sh '" + script.getFullPathName().replace("'", "'\\''") + "' >/dev/null 2>&1 &" });
   #else
    if (wait) { juce::ChildProcess p; return p.start("cmd.exe /V:ON /C \"" + script.getFullPathName() + "\"") && p.waitForProcessToFinish(120000) && p.getExitCode() == 0; }
    // detached: its own process (start /b keeps no window), outlives set.Line
    return juce::File("C:\\Windows\\System32\\cmd.exe").startAsProcess("/V:ON /C start \"\" /b cmd.exe /V:ON /C \"" + script.getFullPathName() + "\"");
   #endif
}

// ---------------------------------------------------------------- --update-test
juce::StringArray selfTest(const juce::File& dir)
{
    juce::StringArray out; bool ok = true;
    auto check = [&](bool c, const juce::String& what) { out.add((c ? "ok   " : "FAIL ") + what); ok = ok && c; };
    dir.deleteRecursively(); dir.createDirectory();
    check(compareVersions("0.1.61", "set.Line 0.1.60") == 1 && compareVersions("set.Line 0.1.9", "0.1.10") == -1 && compareVersions("0.1.60", "0.1.60") == 0 && versionIn("set.Line 0.1.123 (beta)") == "0.1.123",
          "versions compare as numbers (0.1.10 is newer than 0.1.9); the release title's version is read");
    check(cantInstall(currentApp(), "0.1.0").contains("development build"), "a development build (x.y.0) never updates itself in place");
    // a fake release: an app in a zip, its SHA-256 in SHA256SUMS.txt
    const auto apps = dir.getChildFile("Applications"); apps.createDirectory();
   #if JUCE_MAC
    const auto app = apps.getChildFile("set.Line.app");
    const auto build = dir.getChildFile("build/set.Line.app");
    build.getChildFile("Contents").createDirectory(); build.getChildFile("Contents/Info.plist").replaceWithText("new");
    app.getChildFile("Contents").createDirectory(); app.getChildFile("Contents/Info.plist").replaceWithText("old");
    const auto zip = dir.getChildFile(assetName());
    { juce::ChildProcess p; p.start(juce::StringArray { "/usr/bin/ditto", "-c", "-k", "--keepParent", build.getFullPathName(), zip.getFullPathName() }); p.waitForProcessToFinish(60000); }
    auto marker = [](const juce::File& a) { return a.getChildFile("Contents/Info.plist").loadFileAsString(); };
   #else
    const auto app = apps.getChildFile("set.Line");
    app.createDirectory(); app.getChildFile("set.Line.exe").replaceWithText("old");
    const auto zip = dir.getChildFile(assetName());
    { juce::ZipFile::Builder b; const auto src = dir.getChildFile("build"); src.createDirectory(); src.getChildFile("set.Line.exe").replaceWithText("new"); src.getChildFile("onnxruntime.dll").replaceWithText("dll");
      b.addFile(src.getChildFile("set.Line.exe"), 9, "set.Line.exe"); b.addFile(src.getChildFile("onnxruntime.dll"), 9, "onnxruntime.dll");
      juce::FileOutputStream fo(zip); b.writeToStream(fo, nullptr); }
    auto marker = [](const juce::File& a) { return a.getChildFile("set.Line.exe").loadFileAsString(); };
   #endif
    juce::String sha; { juce::FileInputStream in(zip); sha = juce::SHA256(in).toHexString(); }
    juce::String err;
    check(zip.existsAsFile() && verify(zip, sha + "  " + assetName() + "\n" + juce::String::repeatedString("0", 64) + "  other.zip\n", assetName(), err), "the download's SHA-256 matches its line in SHA256SUMS.txt");
    const bool refused = ! verify(zip, juce::String::repeatedString("ab", 32) + "  " + assetName() + "\n", assetName(), err);
    check(refused && err.contains("damaged"), "a damaged download is refused (nothing installed): " + err);
    err = {};
    const auto staged = stage(zip, app, err);
    check(staged.exists() && marker(staged) == "new" && marker(app) == "old", "the update is unpacked next to the app, which isn't touched yet" + (err.isNotEmpty() ? ": " + err : juce::String()));
    const auto sdir = dir.getChildFile("scripts");
    check(runScript(writeSwapScript(sdir, false, app, staged, 999999, false), true) && marker(app) == "new" && marker(previousApp(app)) == "old" && ! staged.exists(),
          "install: the new app in place, the old one kept as \"(previous)\"");
    check(runScript(writeSwapScript(sdir, true, app, {}, 999999, false), true) && marker(app) == "old" && marker(previousApp(app)) == "new", "roll back: the previous app is back, the newer one kept as \"(previous)\"");
    check(runScript(writeSwapScript(sdir, true, app, {}, 999999, false), true) && marker(app) == "new", "roll back again: undone");
    out.add(ok ? "UPDATE OK" : "UPDATE FAILED");
    return out;
}

} // namespace setline::gui::updater
