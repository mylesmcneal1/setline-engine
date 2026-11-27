# Phase 11b · Urgent fix: renaming is misplaced everywhere, and track names get crushed

Seen on the band's 2015 MacBook (macOS 12, WebKit, 1280×800) in 0.1.64. Screenshot: `docs/design/phase11b/rename-offset.png`.

## The problems
1. **The rename field opens in the wrong place, everywhere.** It's offset down and to the right, over neighbouring controls (here the output button), and the old name still shows underneath it. The user: "the boxes for renaming are off EVERYWHERE." The 11 test (field within 2 px of the name) evidently doesn't catch what happens on the real Mac.
2. **Track names get crushed to nothing.** The top track header shows only "…", and the next shows "60 GAR ST…". The output chip, volume slider and M/S buttons take all the width.

## The fix
### 1. No overlay: the name itself becomes the field
- Remove the positioned overlay input entirely. Renaming turns **the name element itself** into the editable field, either with `contenteditable="plaintext-only"` on the element (with a fallback for WebKit 15) or by swapping the element for an `<input>` that sits in the same place in the layout and inherits its font, size, weight, letter-spacing, padding and line-height.
- Nothing is absolutely positioned or measured with `getBoundingClientRect` and copied, so it can't drift because of transforms, zoom, Customize › Text size, scroll offsets or WebKit rounding.
- **Behaviour:** the text is selected on start. ↩ or clicking away saves; Esc restores the old name. Paste is plain text only. The row's height and width don't change while editing (the field fills the name's own box; long names scroll inside it).
- **Apply it to every rename:** setlist rows, cards, Folders rows, the song title, track headers, sections, versions, breaks, the setlist name, the library name, markers, scenes, cue words, presets. **One shared helper**, so they can't differ.

### 2. Track headers: the name gets space first
- **The name gets a minimum width** of about 90 px, or the whole header if it's narrower.
- **When space runs out, shrink in this order:**
  1. the slider becomes a small level knob or shows only on hover
  2. the output chip shortens to "1" with a tooltip
  3. M/S stay
  4. only then does the name truncate with "…"
- **Never show a bare "…".**
- **This applies to every track type and every Track height,** and the same rule goes for setlist rows and cards (the name wins over secondary text).

### 3. Tests that match the real Mac
- **Run the rename tests in the WebKit CI job at 1280×800,** with Text size at 100 % and 120 %, scrolled sideways and down, in single-song view and in Folders, for every rename location.
- **Assert:** the editable element *is* the name element (or occupies its exact box within 1 px), and no other control overlaps it while editing.
- **Assert** no track header name is narrower than 60 px at the default track width with the default font, and none shows only "…".
- **Save before/after screenshots** of each rename location from the WebKit run as CI artifacts.

## Report
- why the overlay was misplaced, in plain words
- before/after screenshots (WebKit, 1280×800) for 6 rename spots: setlist row, card, track header, section, song title, version
- anything that differs from this spec
