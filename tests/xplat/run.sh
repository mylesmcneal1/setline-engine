#!/usr/bin/env bash
# Setlists move between Windows and Mac as .setline packages (docs/phase6c.md, 6f). CI runs:
#   run.sh make  <set.Line executable> <setline-spike> <work dir>   -> <work dir>/show/X Show/... + made.json
#   run.sh check <set.Line executable> <work dir>                   (the other system's show, downloaded there)
# make builds a show from stems with awkward names (accents, in macOS's decomposed form on a Mac, case, and on a
# Mac a "?" Windows can't hold), saves it and renders every song; check opens it on the other system, finds every
# file and renders the same. Exit 1 on any failure.
set -u
mode="$1"; app="$2"
here="$(cd "$(dirname "$0")" && pwd)"
case "$mode" in
  make)  spike="$3"; work="$4" ;;
  check) work="$3" ;;
  *) echo "usage: run.sh make|check ..."; exit 2 ;;
esac
mkdir -p "$work"; work="$(cd "$work" && pwd)"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) win=1 ;; *) win=0 ;; esac
native() { if [ $win = 1 ]; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
json() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

run_app() { # script result
  local t0=$SECONDS
  "$app" --test-script "$(native "$1")" "$(native "$2")" > "$work/app-$mode.log" 2>&1 &
  local pid=$!
  while kill -0 $pid 2>/dev/null; do
    if [ $((SECONDS - t0)) -gt 300 ]; then echo "set.Line didn't finish in 300 s"; kill $pid; break; fi
    sleep 2
  done
  wait $pid 2>/dev/null || true
  [ -f "$2" ] || { echo "no result from set.Line"; tail -50 "$work/app-$mode.log"; exit 1; }
}

report() { # result: print the checks, exit 1 on any failure
  node -e '
    const r = require(process.argv[1]); const c = r.checks || [];
    c.forEach((x) => console.log(x.slice(0, 2000)));
    if (r.error) console.log("ERROR " + r.error);
    const bad = c.filter((x) => !x.startsWith("ok")).length + (r.error ? 1 : 0);
    console.log(bad ? bad + " FAILED" : "all " + c.length + " passed");
    process.exit(bad ? 1 : 0);' "$(native "$1")"
}

if [ "$mode" = make ]; then
  rm -rf "$work/src" "$work/show"; mkdir -p "$work/src" "$work/show"
  (cd "$work" && "$spike" --make-test gen --stems 2 --seconds 14 --rate 48000 > /dev/null) || { echo "make-test failed"; exit 1; }
  if [ $win = 1 ]; then
    a="Ström & Co (Live) #1.wav"; b="UPPER lower.wav"; c="Bass [take 2].wav"
  else
    a="$(printf 'Stro\xcc\x88m & Co (Live) #1.wav')"; b="UPPER lower.wav"; c="What? Mix.wav" # o + combining diaeresis; "?" isn't allowed on Windows
  fi
  cp "$work/gen/00 Marker.wav" "$work/src/$a"
  cp "$work/gen/01 Drums.wav" "$work/src/$b"
  cp "$work/gen/02 Bass.wav" "$work/src/$c"
  show="$work/show/Cross Show/Cross Show.setline"
  cfg=$(node -e 'console.log(JSON.stringify({ src: process.argv.slice(1, 4), show: process.argv[4] }))' \
        "$(native "$work/src/$a")" "$(native "$work/src/$b")" "$(native "$work/src/$c")" "$(native "$show")")
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[2], fs.readFileSync(process.argv[1],"utf8").replace("/*CFG*/null", () => process.argv[3]))' \
    "$(native "$here/make.js")" "$(native "$work/make-run.js")" "$cfg"
  run_app "$work/make-run.js" "$work/made.json"
  report "$work/made.json" || exit 1
  cp "$work/made.json" "$work/show/made.json"
  echo "show files:"; (cd "$work/show" && find . -type f | sort)
else
  show="$work/show/Cross Show/Cross Show.setline"
  [ -f "$show" ] || { echo "no show at $show"; exit 1; }
  echo "show files:"; (cd "$work/show" && find . -type f | sort)
  node -e '
    const fs = require("fs");
    const made = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    const cfg = JSON.stringify({ show: process.argv[4], made });
    fs.writeFileSync(process.argv[2], fs.readFileSync(process.argv[1], "utf8").replace("/*CFG*/null", () => cfg));' \
    "$(native "$here/check.js")" "$(native "$work/check-run.js")" "$(native "$work/show/made.json")" "$(native "$show")"
  run_app "$work/check-run.js" "$work/checked.json"
  report "$work/checked.json" || exit 1
fi
