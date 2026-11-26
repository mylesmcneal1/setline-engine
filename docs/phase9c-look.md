# Phase 9c · Look: transport, outputs pill, native menus, Customize, fonts

Mockups in `docs/design/phase9/`:
- `f1-wall.png`: the A+C transport in place
- `t1-transport.png`: the three transport styles and the outputs pill states
- `tfont.png`: the transport text layouts; the user chose **A · Even**
- `m1-menubar.png`: the menu bar and the Customize menu
- `m2-customize.png`: the Customize panel
- `fonts.png`, `fonts2.png`: the 14 font pairings

## 1. Transport (this was a complaint: "still looks like version one; I want it SUPER NICE")
The default style is **Console**. It mixes mockups A and C as drawn in `f1-wall.png`:
- **One glass capsule:** a subtle top highlight and a soft shadow.
- **The play button:** round with a green glow while playing, and a **ring around it that fills with the song's progress**.
- **Buttons:** previous song, back, stop | play | forward, next song, loop, click (lit in the accent colour when on).
- **The display ("LCD")**, recessed, uses text layout **A · Even** from `tfont.png`:
  - **Cells:** bar.beat.sixteenth (bar number bold) · BPM · meter · song name. The numbers and the song name are the **same size**.
  - **Captions:** every cell has the same small uppercase caption underneath, in the same style and on the same baseline across cells.
  - **Under the position:** 4 beat lights (beat 1 white, the others in the accent colour; with odd meters, one light per group, from 9a), then the clock time.
  - **Under the song name:** the current section in its section colour, and "2:35 left · Chorus in 3".
  - **Along the bottom edge:** a 3 px strip of the song's sections in their colours, with a white playhead tick.
- **No layout shift:** numbers are tabular and the cells have fixed widths, so nothing jiggles while playing.
- **At 1280** it fits alongside Show/Perform/Band and the outputs pill without wrapping. If space runs short, the "left · next" caption truncates first.
- **Customize offers transport styles:** **Console** (default), **Hardware** (option B: lit keys, amber display) and **Minimal** (option C). It also offers text layouts: **Even** (default), **Hero** and **One line** (`tfont.png`).

## 2. Outputs pill replaces the orange banner
- **Remove** the orange "Listening on Built-in Output · everything · Back to show outputs" banner completely.
- **The outputs pill** at the top right has three states:
  - **Interface:** a quiet grey pill, green dot, "iD14 · 48k · 128".
  - **Computer outputs:** the whole pill turns **red** (red tint, red outline, red glowing dot), "This computer · 48k". The tooltip explains why. Clicking it opens the output choice, including "Back to show outputs".
  - **No output:** grey, "No output · click to choose".
- **It's the same on every page,** including Perform. The band screens get a small red "computer outputs" chip in their status line.

## 3. Menus move into the window chrome
- **Mac:** the real menu bar at the top of the screen (JUCE `MenuBarModel::setMacMainMenu`): **set.Line · File · Edit · View · Song · Setlist · Customize · Window · Help**, with the standard app menu (About, Check for updates…, Settings… ⌘,, Hide, Quit).
- **Windows:** the same menus in the window's title bar area, as a native menu bar on the window. No in-app duplicate.
- **Remove** the in-app "File ▾" button and any other in-app menu buttons (an in-app "Options" too, if there is one).
- **The File menu** (as mocked up):
  - New song ⌘N · New setlist ⇧⌘N · Add break ⌘B
  - Import Ableton project… ⌘I · Import audio files… · Import .setline package…
  - Export song or setlist… ⌘E · Print setlist… ⌘P
  - Libraries › · Open recent ›
  - Check for updates… · Settings… (Windows; on the Mac these sit in the app menu)
- **The other menus:**
  - **Edit:** undo, redo, cut, copy, paste, delete, select all, select mode
  - **View:** Show/Perform/Band, Cards/Folders, Collapse all, zoom items, show/hide the setlist
  - **Song:** add track, add section, add time signature, add tempo change, versions
  - **Setlist:** add song, add break, print, rename, duplicate
  - **Window:** minimise, full screen
  - **Help:** docs link, Diagnostics, report a problem
- **Keyboard shortcuts** are shown in the menus and actually work. Menu items grey out when they can't be used (e.g. while playing).
- **Never lose a shortcut** that exists today. List any you had to change.

## 4. Customize menu and panel
- **The Customize menu** (next to File): Theme › · Accent colour › · Fonts › · Text size › · Transport style › · Density › · Customize the look… ⌥⌘, · Reset to default.
- **The Customize the look panel** (`m2-customize.png`) is a sheet with the settings on the left and a **live preview** on the right (the transport plus a few tracks). Changes apply live:
  - **Theme:** Dark (current) · Black (OLED) · Dim · Stage (high contrast: brighter text, thicker outlines, larger captions)
  - **Interface font / Title font / Numbers font:** chosen separately, **or** as one of the 14 pairings below
  - **Accent colour:** 7 swatches plus a custom one
  - **Text size:** 90–130%
  - **Track height:** Compact → Tall
  - **Transport style** and **Transport text layout** (from section 1)
  - **Corners:** Square · Rounded (default) · Extra round
  - **Save as theme…:** named themes, listed in the Theme menu
  - **Reset to default**
- **Settings are per computer,** stored with the app's preferences, not in the library, so the Mac and the PC can look different.
- **Band screens keep their own look** (they're another device), but they use the same title font.
- **Settings › Appearance** keeps Compact layout and Reduce animations from 8a. The look settings live in Customize; Appearance can link to it.

## 5. Fonts: 14 selectable pairings
All the pairings are free (SIL Open Font License) and bundled with the app; no network is needed. Use `@fontsource` packages (latin subset, only the weights used). If a family isn't on fontsource, bundle the OFL files from Google Fonts with their licence text. Load only the fonts in use (lazy `@font-face`), so the 2015 MacBook doesn't pay for all 14.

| # | Name | Titles | Body | Numbers |
|---|---|---|---|---|
| 1 | Stage | Big Shoulders Display | Inter | Geist Mono |
| 2 | Character | Bricolage Grotesque | Bricolage Grotesque | Geist Mono |
| 3 | Studio | Instrument Sans | Instrument Sans | IBM Plex Mono |
| 4 | **Round (default)** | Outfit | Outfit | Outfit (tabular figures) |
| 5 | Bold | Archivo Black | Work Sans | DM Mono |
| 6 | Machine | Tektur | Work Sans | Jura |
| 7 | Marquee | Anton | DM Sans | Geist Mono |
| 8 | Trail | National Park | Fira Sans | Red Hat Mono |
| 9 | Wide | Boldonse | Inter | DM Mono |
| 10 | Tour poster | Smooch Sans | Poppins | IBM Plex Mono |
| 11 | Classic | Montserrat | Montserrat | Jura |
| 12 | Editorial | Gloock | Instrument Sans | IBM Plex Mono |
| 13 | Retro LED | Pixelify Sans | Fira Sans | Silkscreen |
| 14 | Heavy metal | Erica One | Work Sans | Geist Mono |

Today's Inter + JetBrains Mono stays available as **"Original"**.
- **Numbers always use tabular figures,** so the transport doesn't jiggle. If a numbers font has no tabular figures, fix each digit's width.
- **The default is 4 · Round,** because the transport's numbers and words come from one family there.
- **Check every pairing at 1280×800:** the transport, a song header, the setlist and the card wall. Long song names truncate cleanly with an ellipsis. Add a CI layout snapshot per pairing (transport + card wall), saved as artifacts.
- **macOS 12 WebKit:** test that every font renders there. The CI layout check uses Chrome, so add a note to the manual test list.
