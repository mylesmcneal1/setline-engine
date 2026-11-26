# The look and the menus (9c)

Code: `ui/public/look9.js` / `look9.css` (fonts, themes, transport, outputs pill, Customize), `ui/public/menus9.js`
(the menus), `app-gui/AppMenus.*` (the menus in the window chrome).

## Menus
The menus live in the window chrome: the macOS menu bar (set.Line · File · Edit · View · Song · Setlist · Customize ·
Window · Help) and, on Windows, a menu bar on the window (the same menus; Check for updates…, Settings… and Exit are in
File there). There is no in-app File button any more. The page describes the menus (labels, shortcuts, greyed items
while playing) and the app shows them; a chosen item comes back to the page as a command.

Shortcuts (shown in the menus and handled by the page):

| Shortcut | Does |
|---|---|
| ⌘N | New song… (**changed**: it was New setlist) |
| ⇧⌘N | New setlist |
| ⌘B | Add break (9d) |
| ⌘I | Import Ableton project… |
| ⌘E | Export song or setlist… |
| ⌘P | Print setlist… |
| ⌘1 / ⌘2 / ⌘3 | Show / Perform / Band |
| ⌥⌘← | Collapse all |
| ⌘, | Settings… |
| ⌥⌘, | Customize the look… |
| ⌘M, ⌃⌘F (Mac) | Minimise, full screen |

All the earlier shortcuts still work (Space, Enter, K, C, N, P, V, L, M, [, ], −, =, ⌘Z / ⇧⌘Z, ⌘C / ⌘X / ⌘V,
⌘D, ⌘A, ⌘J, Delete, Esc). On the Mac, Edit's cut / copy / paste / select all don't show their keys in the menu, so
that the text fields keep the system's own (the keys work as before).

## Customize
Customize › Theme · Accent colour · Fonts · Text size · Transport style · Density · Customize the look… (⌥⌘,) · Reset.
The look is per computer (the app's preferences and the page's storage), never in the library.

- **Themes:** Dark, Black (OLED), Dim, Stage (brighter text, thicker outlines, larger captions), and themes you save.
- **Fonts:** 14 pairings + Original (Inter / JetBrains Mono); **Round** (Outfit) is the default. Or the interface,
  title and numbers fonts separately. All are bundled (SIL Open Font License; latin; only the weights used); a font
  is loaded only when it's used. Their licence texts: `ui/public/licenses/fonts/`.
- **Text size** 90–130% (the editor and Perform; the top bar stays the same so it fits at 1280).
- **Track height** Compact → Tall; **Corners** Square / Rounded / Extra round; **Accent colour** 7 + your own.

## Transport
Console (default): one glass capsule; previous song · back · stop | play | forward (next section) · next song ·
loop · click; the play button glows green while playing and its ring fills with the song's progress. The display
(text layout **Even**): bar.beat.sixteenth (bar bold) · BPM · meter · song, the same size, each with the same small
caption; beat lights (one per group in odd meters) and the clock under the position; the section and "2:35 left ·
Chorus in 3" under the song; a 3 px strip of the sections with the playhead along the bottom. Digits are tabular and
the cells fixed, so nothing moves while playing. Also **Hardware** and **Minimal**, and the layouts **Hero** and
**One line**.

## Outputs pill
No more orange "Listening on…" banner. The pill at the top right: the interface ("iD14 · 48k · 128", green dot),
**red** "This computer · 48k" when the show plays on the computer's outputs (its tooltip says why), or "No output ·
choose". Click it to choose (including Back to show outputs). The band screens show a small red "computer outputs"
chip, and use the app's title font for song names.
