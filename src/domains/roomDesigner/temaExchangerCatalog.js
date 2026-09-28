// TEMA shell-and-tube exchanger entries for the process-equipment catalog.
//
// Detailed versions live as NEW entries in their own categories (owner
// decision): the existing simple "shell-tube-exchanger" and
// "kettle-reboiler" glyphs are untouched, so old drawings look the same.
//
//   - "tema-exchanger": one configurable exchanger. The placed instance
//     stores its { front, shell, rear, tubePasses } in the optional
//     instance field `tema`; the catalog default is AES.
//   - 20 component shapes (5 front heads, 7 shells, 8 rear heads), each
//     individually placeable.
//
// Every entry carries `tema` metadata that the draw routine and the
// geometry module (temaGeometry.js) read; `categoryGroup` lets the library
// group the four categories under one heading.
//
// Declarative data only. Dimensions are nominal planning sizes in inches.

import { TEMA_FRONT_HEADS, TEMA_PRESETS, TEMA_REAR_HEADS, TEMA_SHELLS } from "./temaTypes";

export const TEMA_CATEGORY_GROUP = "TEMA heat exchangers";
export const TEMA_CATEGORIES = Object.freeze(["TEMA exchangers", "TEMA front heads", "TEMA shells", "TEMA rear heads"]);

const [EXCHANGERS, FRONTS, SHELLS, REARS] = TEMA_CATEGORIES;
const HX_COLOR = "#f59e0b";

const entry = (fields) => Object.freeze({
  shape3d: "hcyl",
  defaultLayer: "equipment",
  color: HX_COLOR,
  categoryGroup: TEMA_CATEGORY_GROUP,
  ...fields,
});

// Nominal component footprints (inches) at a 42" envelope depth.
const FRONT_WIDTH = { A: 24, B: 18, C: 24, N: 24, D: 30 };
const REAR_WIDTH = { L: 24, M: 18, N: 24, P: 24, S: 24, T: 24, U: 18, W: 24 };

const component = (position, category, t, widthIn, depthIn = 42) => entry({
  id: `tema-${position}-${t.letter.toLowerCase()}`,
  label: `TEMA ${position === "shell" ? "shell" : `${position} head`} ${t.letter} — ${t.name}`,
  category,
  glyph: `tema-${position}-${t.letter.toLowerCase()}`,
  widthIn,
  depthIn,
  heightIn: depthIn,
  tagPrefix: null, // a component is part of an exchanger, not a tagged item
  tema: Object.freeze({ kind: "component", position, letter: t.letter, defaultMode: "detailed" }),
});

export const TEMA_EQUIPMENT = Object.freeze([
  entry({
    id: "tema-exchanger",
    label: "Shell-and-tube exchanger (TEMA, configurable)",
    category: EXCHANGERS,
    glyph: "tema-exchanger",
    widthIn: 192,
    depthIn: 42,
    heightIn: 48,
    tagPrefix: "E",
    tema: Object.freeze({ kind: "assembly", defaultConfig: TEMA_PRESETS.AES, defaultMode: "detailed" }),
  }),
  ...TEMA_FRONT_HEADS.map((t) => component("front", FRONTS, t, FRONT_WIDTH[t.letter])),
  ...TEMA_SHELLS.map((t) => component("shell", SHELLS, t, t.letter === "K" ? 120 : 96, t.letter === "K" ? 66 : 42)),
  ...TEMA_REAR_HEADS.map((t) => component("rear", REARS, t, REAR_WIDTH[t.letter])),
]);

// Simple symbol -> its detailed replacement ("replace with detailed version").
const DETAILED_VERSIONS = Object.freeze({
  "processEquipment/shell-tube-exchanger": Object.freeze({ symbolId: "tema-exchanger", tema: TEMA_PRESETS.AES }),
  "processEquipment/kettle-reboiler": Object.freeze({
    symbolId: "tema-exchanger",
    tema: Object.freeze({ front: "B", shell: "K", rear: "U", tubePasses: 2 }),
  }),
});

/** The detailed replacement for a simple symbol, or null when it has none. */
export function detailedVersionFor(domain, symbolId) {
  const found = DETAILED_VERSIONS[`${domain}/${symbolId}`];
  return found ? { symbolId: found.symbolId, tema: { ...found.tema } } : null;
}
