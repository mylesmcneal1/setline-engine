# Phase 8a: UI polish pass

Claude rendered every screen, panel, menu and dialog of build 0.1.52 at 1440×900 and 1280×800. Screenshots are in `docs/design/audit-8a/`.

**The rule from now on:**
- Every screen, panel, menu and dialog must look right at **1280×800**, the band's 2015 MacBook, and up.
- Nothing wraps unexpectedly, overlaps or runs off an edge.
- No empty pages.
- Add a CI check that renders the main views at 1280×800 and fails on horizontal overflow in the top bar or the right panel, if that's practical. Otherwise screenshot them in the report.

## Broken or empty
1. **Setlist menu (`setlistMenu`) shows coloured bars with no setlist names.** Show each name with its song count, and a ✓ on the current one (`fix-setlist-menu.png`).
2. **Settings → Appearance is blank.** It should hold Dark / Darker and anything else that belongs there.
3. **Settings → Outputs and Diagnostics are blank** in the browser preview. Check them in the app.
   - Both need a proper state when there's no device: Outputs says "Connect an interface to name its outputs" and still lists the last device's names; Diagnostics shows version, OS, startup timings, and Copy/Save.
4. **The Band page with no screens has a big empty right third.** Show the widget library dimmed, with a short "Add a screen to start" call to action. The empty state shouldn't look broken.

## Cramped at 1280×800
5. **The top bar overflows.**
   - On Perform, "Sync MIDI" and the setlist picker wrap onto 2–3 lines, and the audio pill runs off the edge.
   - On Show, the position/BPM/meter/song box truncates ("92.", "Glas:").
   - Fix with a responsive top bar: icon-only buttons with tooltips below about 1400 px, the setlist picker as one truncated line, and the song name dropped from the timer box when it's narrow. Nothing ever wraps.
6. **"File ▾" wraps**, with the arrow dropping under the word. Keep it on one line.
7. **The Show view timeline is squeezed.** At 1280 px, collapse the setlist sidebar and the right panel to icons/drawers by default, or let them overlay, so the timeline gets at least about 55% of the width.

## Squashed text and buttons
8. **About dialog:** "Copy diagnostics" and "Save diagnostics…" wrap inside small buttons. Size the buttons to their text.
9. **Section panel:** "At the end" (Continue / Loop / Hold / Stop) and the Notes role tabs are crammed. Give them room, or turn them into a dropdown / two rows.
10. **Overlapping labels:**
    - On the Cues lane, close cues overlap ("Tur|Chorus"). Stack or abbreviate them, with the full text on hover.
    - The MIDI editor's section strip has the same problem.
11. **Cue panel:** "Same voice for every song" wraps awkwardly, and the Preview / Pronunciations / Recorded word / Only in this song buttons don't line up. Tidy them into a consistent grid.

## Inconsistent details
12. **Track type icons are text glyphs** (·, “, ∿, ⎍). Use proper SVG icons (click, cue, audio, MIDI) everywhere they appear: headers, menus, panels.
13. **Menu icons are mixed** (✎ ● ↑ ↓ ⧉ ⌫). Use one consistent SVG icon set across all context menus.
    - The song menu's first item "Close" is unclear: rename it to "Collapse song" or remove it.
14. **The song header row ends with a stray "·"** ("92 BPM · 4/4 ·") when there's no key. Never leave dangling separators.
15. **Brand spelling:** "Set.Line" appears in the New Song dialog. It's always **set.Line**. Search all strings.
16. **Unlabelled song row badges** ("⇅ 2", "05"). Label them or add tooltips, e.g. "2 versions", "#5 in setlist", or remove them if redundant.
17. **Perform low contrast:** the current section name is grey and hard to read when it's a version-only section ("Intro pad"). Use full contrast, and mark version-only sections with ◆ instead of dimming them.
18. **Settings help text is too technical.** The MIDI sync point help ("PC 1:0:12 · CC 7 100 · raw B0 07 64") should be written in plain words. Move the syntax into a "Message formats" info popover.

## Done when
- All 18 are fixed.
- Before/after screenshots at 1280×800 for Show, Perform, Band, every Settings tab, and the setlist/song menus are in the report.
- CI is green. Commit and push.
