# Testing on the Mac, remotely

The development PC and the Mac (a 2015 MacBook Pro: Intel, macOS 12) never need to share files. Builds reach the
Mac through GitHub:

1. **Claude Code pushes** a change to `main`.
2. **CI builds and tests it** on Windows and macOS (`.github/workflows/build.yml`). When everything is green, the
   `release` job replaces the GitHub prerelease tagged **`latest`**:
   - `set.Line-macos.zip`: the app, zipped with `ditto` (universal: Intel + Apple Silicon, macOS 10.15+);
   - `setline-spike-macos.tar.gz`: the command-line engine spike;
   - `set.Line-windows.zip`, `setline-spike-windows.zip`;
   - `setline-update.sh`, `install-update-command.sh`: the Mac update command;
   - `SHA256SUMS.txt`: a SHA-256 for every file above;
   - release notes: the version and the commits since the previous `latest`.

   Every build is version **0.1.<CI run number>**. It's shown on the loading window ("Beta 0.1.<n>"), in
   set.Line > About set.Line in the Mac menu bar (Windows: Help menu shows the build in Diagnostics), and in the release title.
   The `mac-update` job then runs the update command against that release on a CI Mac, so a broken update
   never reaches you silently.
3. **On the Mac, run `setline-update`.** It downloads `latest`, checks the SHA-256, asks you to quit set.Line if
   it's running, installs it in `/Applications`, and prints the old and new version and the release notes.

   **From 8d on, no Terminal is needed.** In set.Line, use **set.Line › Check for updates…** (Mac menu bar; Windows: File › Check for updates…): it shows the release
   notes, then downloads, checks the SHA-256 and installs the same way (the build before is kept as
   "set.Line (previous).app"), and restarts. It never installs while playing; it waits until you stop.
   **Roll back to the previous version…** is in the same dialog. set.Line also checks quietly once a day, a few
   seconds after launch, and only says something when there's a newer build. While the repository is private,
   add a GitHub access token that can read it in Settings › General › Updates.

## One-time setup on the Mac
In Terminal:

```
brew install gh                 # the GitHub CLI (or the installer from https://cli.github.com)
gh auth login                   # GitHub.com > HTTPS > log in with a web browser
mkdir -p ~/setline-tools && cd ~/setline-tools
gh release download latest -R mylesmcneal1/setline-engine -p 'setline-update.sh' -p 'install-update-command.sh' --clobber
bash install-update-command.sh  # makes "setline-update" a command
```

If Homebrew isn't installed, either install it from https://brew.sh, or download the macOS `.pkg` of gh from
https://github.com/cli/cli/releases.

## Every update
```
setline-update            # install the newest build
setline-update --check    # installed vs latest, no changes
setline-update --rollback # back to the build before (run again to undo)
setline-update --spike    # also install the engine spike into ~/setline-spike
```

- The previous build stays as `/Applications/set.Line (previous).app`.
- The command updates itself from the release when it changes.
- The first time a new build opens, macOS may say it's from an unidentified developer (the app isn't notarized
  yet). `setline-update` removes the download quarantine, which usually avoids this; if it still appears,
  right-click set.Line in Applications > Open > Open.

## When something goes wrong
- "gh isn't installed / isn't logged in": run the setup above.
- "no latest release": CI hasn't published one yet (it only publishes after a green build on `main`). Check the
  Actions tab on GitHub.
- "doesn't match its SHA-256": the download was damaged; run `setline-update` again.
- set.Line won't quit (it asks to save): answer it, then run `setline-update` again.
