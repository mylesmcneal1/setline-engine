// set.Line's words: one glossary for the menus, buttons, tooltips, ⌘K, the remote screens and the docs (10b).
// The page's own scripts (ui/public/*.js) read it as window.SLWords. A visible string uses these words, never an
// internal name ("pack", "pads", "lane id", "pool", "malt"…).
export const WORDS = {
  song: "Song",            // one piece of music: its tracks, tempo map, time signatures, sections, cues and click
  version: "Version",      // another arrangement of a song (sections left out or added, or its own timeline: 10c)
  section: "Section",      // a named span of bars: Intro, Verse, Chorus…
  cue: "Cue",              // a spoken word at a bar ("Chorus", "One, two, three, four")
  click: "Click",          // the metronome, as notes on a Click track (Accent and Click lanes: 10c)
  track: "Track",          // audio, click, cues or MIDI, in one song
  setlist: "Setlist",      // the running order of a show: songs and breaks
  break: "Break",          // time between songs (gear change, tuning, talk, intermission)
  library: "Library",      // every song and setlist, with the audio, in one folder
  preset: "Preset",        // a Quad Cortex / Axe-Fx preset (or scene) a MIDI track sends
  timeSignature: "Time signature",
  tempo: "Tempo",
  marker: "Marker",
} as const;

// Words not to show, and what to say instead (the wording pass checks the page against this list).
export const NOT_THESE: Record<string, string> = {
  "pack": "package (.setline)",
  "pads": "cue words",
  "pool": "library",
  "lane id": "track",
  "stems": "audio files",
  "malt": "MIDI version",
  "OK": "a button that says what it does",
};

declare global { interface Window { SLWords?: typeof WORDS } }
if (typeof window !== "undefined") window.SLWords = WORDS;
