#!/bin/bash
# setline-update: install the newest set.Line build on this Mac, in one command.
#
# Takes the "latest" prerelease of mylesmcneal1/setline-engine (published by CI after every green build on
# main), checks its SHA-256, and installs set.Line.app into /Applications. The app you had becomes
# "set.Line (previous).app", so --rollback can bring it back.
#
#   setline-update             install the latest build
#   setline-update --check     only say which build is installed and which is the latest
#   setline-update --rollback  swap back to the previous build
#   setline-update --spike     also install the command-line spike into ~/setline-spike
#
# More (mostly for CI): --yes (don't ask, quit set.Line if it's running), --dest <folder> (instead of
# /Applications), --spike-dest <folder>, --repo <owner/name>.
#
# Needs only the GitHub CLI ("gh"), logged in once with "gh auth login". Works with macOS's own bash 3.2.
set -euo pipefail

REPO="mylesmcneal1/setline-engine"
TAG="latest"
DEST="/Applications"
SPIKE_DEST="$HOME/setline-spike"
APP_NAME="set.Line"
MODE="install"
SPIKE=0
YES=0

say()  { printf '%s\n' "$*"; }
fail() { printf 'setline-update: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --rollback) MODE="rollback" ;;
    --spike) SPIKE=1 ;;
    --yes|-y) YES=1 ;;
    --dest) shift; DEST="${1:?--dest needs a folder}" ;;
    --spike-dest) shift; SPIKE_DEST="${1:?--spike-dest needs a folder}" ;;
    --repo) shift; REPO="${1:?--repo needs owner/name}" ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option: $1 (try --help)" ;;
  esac
  shift
done

APP="$DEST/$APP_NAME.app"
PREV="$DEST/$APP_NAME (previous).app"

version_of() { # the app's version ("0.1.123"), or "none"
  local plist="$1/Contents/Info.plist"
  if [ -f "$plist" ]; then /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$plist" 2>/dev/null || echo "unknown"
  else echo "none"; fi
}

need_gh() {
  command -v gh >/dev/null 2>&1 || fail "the GitHub CLI (gh) isn't installed.
  Install it with Homebrew:   brew install gh
  or download it from:        https://cli.github.com
  then log in once with:      gh auth login"
  gh auth status >/dev/null 2>&1 || fail "gh isn't logged in to GitHub. Run:   gh auth login
  (choose GitHub.com, HTTPS, and log in with a web browser)"
}

latest_title() { gh release view "$TAG" -R "$REPO" --json name -q .name 2>/dev/null || true; }

running() { pgrep -x "$APP_NAME" >/dev/null 2>&1; }

quit_app() { # asks first unless --yes; quits set.Line the normal way (it asks to save if needed)
  running || return 0
  if [ "$YES" -ne 1 ]; then
    printf 'set.Line is running. Quit it now to update? [y/N] '
    read -r answer
    case "$answer" in y|Y|yes|YES) ;; *) fail "set.Line is still running; quit it and run setline-update again." ;; esac
  fi
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  local i=0
  while running && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
  running && fail "set.Line didn't quit (maybe it's asking to save). Quit it yourself, then run setline-update again."
  return 0
}

case "$MODE" in
  check)
    need_gh
    say "Installed: $(version_of "$APP")"
    title="$(latest_title)"
    [ -n "$title" ] || fail "no \"$TAG\" release found in $REPO yet (CI publishes it after a green build on main)."
    say "Latest:    $title"
    exit 0 ;;
  rollback)
    [ -d "$PREV" ] || fail "there's no previous build to go back to ($PREV)."
    quit_app
    old="$(version_of "$APP")"
    tmp="$DEST/$APP_NAME (rollback).app"
    rm -rf "$tmp"
    [ -d "$APP" ] && mv "$APP" "$tmp"
    mv "$PREV" "$APP"
    [ -d "$tmp" ] && mv "$tmp" "$PREV"
    say "Rolled back: $old -> $(version_of "$APP")  (run setline-update --rollback again to undo)"
    exit 0 ;;
esac

# ---- install the latest build
need_gh
[ -d "$DEST" ] || mkdir -p "$DEST" || fail "can't create $DEST"
[ -w "$DEST" ] || fail "can't write to $DEST. Make sure you're using an administrator account (or run with --dest ~/Applications)."
work="$(mktemp -d "${TMPDIR:-/tmp}/setline-update.XXXXXX")"
trap 'rm -rf "$work"' EXIT

title="$(latest_title)"
[ -n "$title" ] || fail "no \"$TAG\" release found in $REPO yet (CI publishes it after a green build on main)."
say "Downloading $title ..."
patterns=(-p "set.Line-macos.zip" -p "SHA256SUMS.txt" -p "setline-update.sh")
[ "$SPIKE" -eq 1 ] && patterns+=(-p "setline-spike-macos.tar.gz")
gh release download "$TAG" -R "$REPO" "${patterns[@]}" -D "$work" --clobber || fail "the download failed (check your internet connection and: gh auth status)."

say "Checking the SHA-256 ..."
(
  cd "$work"
  for f in set.Line-macos.zip $( [ "$SPIKE" -eq 1 ] && echo setline-spike-macos.tar.gz ); do
    line="$(grep "  $f\$" SHA256SUMS.txt || true)"
    [ -n "$line" ] || { echo "no checksum for $f in SHA256SUMS.txt" >&2; exit 1; }
    printf '%s\n' "$line" | shasum -a 256 -c - >/dev/null || { echo "$f doesn't match its SHA-256" >&2; exit 1; }
  done
) || fail "the download is damaged or incomplete; nothing was installed. Try again."

ditto -x -k "$work/set.Line-macos.zip" "$work/app" || fail "couldn't unzip set.Line-macos.zip"
[ -d "$work/app/$APP_NAME.app" ] || fail "the zip doesn't contain $APP_NAME.app"
xattr -dr com.apple.quarantine "$work/app/$APP_NAME.app" 2>/dev/null || true

quit_app
old="$(version_of "$APP")"
if [ -d "$APP" ]; then
  rm -rf "$PREV"
  mv "$APP" "$PREV"
fi
mv "$work/app/$APP_NAME.app" "$APP"
new="$(version_of "$APP")"

if [ "$SPIKE" -eq 1 ]; then
  mkdir -p "$SPIKE_DEST"
  tar -xzf "$work/setline-spike-macos.tar.gz" -C "$SPIKE_DEST"
  chmod +x "$SPIKE_DEST/setline-spike" 2>/dev/null || true
  xattr -dr com.apple.quarantine "$SPIKE_DEST" 2>/dev/null || true
  say "Spike:     $SPIKE_DEST/setline-spike"
fi

# keep this command up to date too (it's in the release next to the app)
self="$0" # follow the "setline-update" link to the real file (macOS 12's readlink has no -f)
while [ -L "$self" ]; do t="$(readlink "$self")"; case "$t" in /*) self="$t" ;; *) self="$(dirname "$self")/$t" ;; esac; done
if [ -f "$work/setline-update.sh" ] && ! cmp -s "$work/setline-update.sh" "$self" && [ -w "$self" ]; then
  cp "$work/setline-update.sh" "$self.new" && chmod +x "$self.new" && mv "$self.new" "$self" && say "(setline-update itself was updated too)"
fi

say ""
say "set.Line updated: $old -> $new"
say "Installed in:    $APP"
[ -d "$PREV" ] && say "Previous build:  $PREV  (setline-update --rollback to go back)"
say ""
say "Release notes:"
gh release view "$TAG" -R "$REPO" --json body -q .body 2>/dev/null | sed 's/^/  /' || true
