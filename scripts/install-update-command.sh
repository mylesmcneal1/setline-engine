#!/bin/bash
# Makes "setline-update" a command on this Mac (run once).
#
# Copies setline-update.sh to ~/.setline/setline-update.sh and links it as "setline-update" in
# /usr/local/bin (if you can write there) or ~/bin (then adds ~/bin to your PATH in ~/.zprofile and
# ~/.bash_profile if it isn't there yet).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd -P)"
src="$here/setline-update.sh"
[ -f "$src" ] || { echo "install-update-command: setline-update.sh isn't next to this script ($here)." >&2; exit 1; }

home_dir="$HOME/.setline"
mkdir -p "$home_dir"
cp "$src" "$home_dir/setline-update.sh"
chmod +x "$home_dir/setline-update.sh"

if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  bin=/usr/local/bin
else
  bin="$HOME/bin"
  mkdir -p "$bin"
fi
ln -sf "$home_dir/setline-update.sh" "$bin/setline-update"
echo "Installed: $bin/setline-update -> $home_dir/setline-update.sh"

case ":$PATH:" in
  *":$bin:"*) echo "Ready: type  setline-update" ;;
  *)
    line="export PATH=\"$bin:\$PATH\""
    for f in "$HOME/.zprofile" "$HOME/.bash_profile"; do
      grep -qsF "$line" "$f" || printf '\n# set.Line: setline-update\n%s\n' "$line" >> "$f"
    done
    echo "Added $bin to your PATH (in ~/.zprofile and ~/.bash_profile)."
    echo "Open a new Terminal window (or run:  export PATH=\"$bin:\$PATH\" ), then type  setline-update"
    ;;
esac
