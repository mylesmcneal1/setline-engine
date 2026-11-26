# Phase 8c: Modeler-native MIDI (Quad Cortex + Axe-Fx III)

**The idea:** when a MIDI track is set to a known modeler, its lane and editor look and work like that modeler. You see presets and coloured scenes, not raw CC/PC numbers.

The band uses a **Neural DSP Quad Cortex** and a **Fractal Axe-Fx III**.

**Generic stays the default.** Any MIDI device still works exactly as now.

Mockups are in `docs/design/modeler-midi/`:
- `q1-modeler-midi.png` / `qc.html`: Quad Cortex
- `q2-axefx-midi.png` / `axe.html`: Axe-Fx III
- `q3-preset-fields.png` / `qc2.html`: preset fields

---

## 1. Device profiles (per MIDI track)
- **Device:** Quad Cortex / Axe-Fx III / Generic, set in the track's right panel. Helix and Kemper can be listed as "coming later" or left out.
- **Header:** shows a small device badge (QC / AXE III), the device name and channel, and a status line (QC: "Setlist N · Scene mode"; Axe: "Preset N · Scenes 1–8").

## 2. Quad Cortex profile
Messages to send (verify against Neural DSP's docs):
- **Preset:**
  1. CC#0 = preset group (0 for presets 1–128, 1 for 129–256)
  2. CC#32 = setlist (0–12)
  3. Program Change = preset within the group
- **Scene A–H:** CC#43, values 0–7.
- **Footswitch A–H (stomp) presses:** CC#35–42.
- **Mode on load (optional):** CC#47, value 0 Preset / 1 Scene / 2 Stomp.

UI:
- a bank grid of 1A–1H … 32A–32H
- a setlist picker
- preset name
- scenes **A–H**
- footswitch ticks on the lane

## 3. Axe-Fx III profile
Messages to send:
- **Preset by number (0–1023):** Bank Select CC#0 = preset ÷ 128, then Program Change = preset mod 128. Preset 0 = 0,0; 128 = 1,0.
- **Scenes 1–8:** a CC chosen by the user, which must match the Axe's Setup › MIDI/Remote › Scene Select. **Default 34**, values 0–7.
- The setting **"Scene Select CC"** appears in the track panel with that hint.

UI:
- the preset number shown big (e.g. **414**) plus its name
- search by number or name in the user's saved preset names
- scenes numbered **1–8**

## 4. The lane (both profiles)
- **A thin preset bar on top:** "Preset 17A · Glasshouse Rig" or "Preset 414 · Seneca Lead". The preset is sent once at the bar's start, and the song can change preset mid-song.
- **Coloured scene blocks below**, each showing the letter/number + name ("C · Lead" / "3 · Lead").
- **Footswitch presses** as small ticks (QC).
- **Fully drag and drop:**
  - drag a scene from the palette (right panel) onto the lane
  - drag blocks to move them; Alt/Option-drag to copy
  - drag edges to change where a scene starts and ends
  - drop a scene onto a block to replace it
  - drag a preset from the bank grid onto the preset bar
  - Shift-click for multi-select
  - double-click the lane for a scene picker popover that shows the exact message it sends ("Sends CC 43 = 2 (Scene C) on Ch 1")
  - everything snaps to the grid
- **Under the hood this is the existing MIDI events model.** Existing MIDI clips keep working, and switching a track to Generic shows the raw events.

## 5. Scene names and colours (per preset)
- Each preset stores its 8 scene names and colours. The defaults are A–H / 1–8 with the palette from the mockup.
- Click a scene tile to rename it or recolour it.
- Every song using that preset shows the same names and colours.
- set.Line can't read these from the device, so the user sets them once.

## 6. Preset fields
- **Custom fields on a preset**, e.g. Tuning, Guitar, Pickup / setting, Tech notes. They use the same field definitions as song fields (6g), plus preset-only fields.
- **Every song using that preset inherits the values; a song or version can override one.**
- Band screen widgets and **"Until next change"** can use preset fields. For example, the guitar tech's tuning countdown can come from the presets.

## 7. Where presets live
Presets, with their names, scene names/colours and fields, are stored in the **Library**, per device profile. They're reused across songs and setlists.

## 8. Ableton import
If a Live MIDI track is named like QC / QUAD / AXE / FX3, suggest the matching profile in the import preview. That covers STAGE QC, RACK QC and AXE FX in the user's project; those tracks are empty today, so only the profile gets set.

## Tests
- message generation for both devices: QC preset 129 in setlist 5 → CC0=1, CC32=5, PC 0; QC scene C → CC43=2; Axe preset 414 → CC0=3, PC 30; Axe scene 3 with CC 34 → CC34=2
- preset fields inheritance and override
- drag-and-drop model operations (move, copy, replace, edge drag)

## Done when
- Tests pass and CI is green.
- Screenshots of both profiles at 1280×800 are in the report.
- Commit and push.
