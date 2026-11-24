# Before the public beta

Open questions to settle before set.Line goes to anyone outside the team.

## Cue voices: where misaki's dictionaries come from
The Kokoro voices turn text into phonemes with misaki's English dictionaries (`us_gold`, `us_silver`,
`gb_gold`, `gb_silver`). The app downloads them from `hexgrad/misaki` at commit `fba12365`.

That repository is Apache-2.0, but it doesn't say where the word lists came from (for example a CMU,
Wiktionary or WordNet source, each with its own terms). Before the beta, do one of these:
- **Confirm the provenance:** ask the author, or trace the data, and record the sources and their
  licences in THIRD_PARTY.md.
- **Or replace them** with our own dictionaries:
  - a cue-word list we write ourselves (music words, numbers, count-ins, section names) in Kokoro's
    phonemes;
  - plus CMUdict (BSD-style licence) for everything else, converted from ARPAbet to Kokoro's
    phonemes;
  - British pronunciations would need either our own list or a mapping from the American ones.

Either way, the app only reads `<models>/kokoro-v1.0/misaki/*.json` through `app-gui/Kokoro.cpp`
(`lexicon()`), so replacing them is local to that file plus the pinned file list.

## Also still open (from earlier notes)
- **JUCE licence:** closed source needs a JUCE licence (the free Starter tier may apply). See
  THIRD_PARTY.md.
- **ASIO licence:** Steinberg's proprietary agreement, or GPLv3. See the README's "Shipping note".
