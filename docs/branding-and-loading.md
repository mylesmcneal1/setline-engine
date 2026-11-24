# set.Line: app icon, wordmark, loading screen

Do this after phase 6b. Same rules as before: report and commit after each part.

## Files (approved by the user, use as-is, don't redraw)
`assets/brand/`
- `setline-icon.svg` master icon (stacked section bars + white playhead, dark rounded square).
  `setline-icon-small.svg` is the simplified version for 32 px and below.
- `setline-icon-macos.svg` the same icon on Apple's icon grid (824/1024 with shadow).
- `setline.ico` Windows icon (16–256). `setline.icns` macOS icon. If the .icns is missing a size
  on the Mac, rebuild it in CI with `iconutil` from `png/mac-*.png`.
- `png/` every size, `win-*` and `mac-*`.
- `setline-wordmark-dark-bg.svg`, `-light-bg.svg`, `-text-only.svg`: the "set.Line" wordmark with
  its section strip, as outlines (no font needed).

Colors: Intro #6b7cff, Verse #22c3a6, Pre #a46bff, Chorus #f5a524, Bridge #ff5fa2, Outro #7d8696,
playhead #ffffff, icon ground #16191e, window #0b0c0e, text #e9ebef, secondary #8a909b, dot #f5a524.

## 1. Icons in place
- Windows: the .exe icon, window/taskbar icon, Start menu (via juce_add_gui_app ICON_BIG/ICON_SMALL
  or the .ico in the resource file, whichever gives all sizes).
- macOS: the .app bundle icon (Dock, Finder, Cmd-Tab).
- The top bar of the Edit window uses the wordmark SVG, not live text.

## 2. Loading screen
Reference: `docs/design/loading-screen.reference.html` (open it in a browser; it loops the animation).
- A small borderless window (720 × 440, rounded 14 px, centered) shown the moment set.Line starts,
  before the main window. Dark from the first frame (no white flash) in Dark and Darker.
- Layout: icon (132 px) on the left; to its right, the wordmark's TOP lines up with the icon's top,
  "Beta <version>" under it, then the checklist. The section strip runs along the bottom
  (56 px side margins, 36 px from the bottom, 6 px tall).
- Checklist steps are real, in this order, each shows a spinner while running and a tick + detail when done:
  Audio (interface · driver · rate · buffer), Show (name · song count), Waveforms (n of total),
  Cues (n ready, or "none").
- The strip is the progress bar: grey underneath, colors revealed behind the white playhead as it
  moves; the playhead in the icon sweeps across its bars in sync. Progress follows the real steps
  (smoothly animated between them, never jumping backwards). "· Ready" appears in green, then the
  splash fades and the main window shows.
- A fast start must not flash: keep the splash at least ~700 ms, and at most as long as loading takes.
- The main window accepts no file drops until loading has finished.
- Honour "reduce motion": no sweeping, just the strip filling.

## 3. When something fails
Reference: `docs/design/loading-error.reference.html`.
- Same window. Title says what's wrong in plain words, one line of help, and the choices.
- Audio interface missing: "Try again", "Choose another output…", "Open without audio".
- Show can't be opened: "Open another show…", "Start a new show". Missing stems don't block
  loading (they're handled in the show as today).

## Tests
- Splash shows before anything else, with no white frame (screenshot the first frames).
- Each step's detail matches the real state; progress never goes backwards.
- Unplug the interface: the error screen appears; Try again works after plugging it back in;
  Open without audio opens the show.
- Icons appear correctly in the Windows taskbar/Start menu/Explorer and in the macOS build.
