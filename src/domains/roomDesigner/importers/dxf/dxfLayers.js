/**
 * Layer roles: how each DXF layer's content is imported. Suggested from the
 * layer name (AIA/NCS-style names like A-WALL, A-DOOR, A-GLAZ, A-AREA and
 * our own export's A-L01-WALL…), always overridable by the user — layer
 * naming varies too much between offices to trust a guess blindly.
 */

export const LAYER_ROLES = Object.freeze([
  { id: "walls", label: "Walls" },
  { id: "doors", label: "Doors" },
  { id: "windows", label: "Windows" },
  { id: "rooms", label: "Rooms (outlines & names)" },
  { id: "annotation", label: "Annotation (as drawn)" },
  { id: "ignore", label: "Ignore" },
]);

const RULES = [
  [/DEFPOINTS/, "ignore"],
  [/HATCH|PATT|POCHE/, "annotation"],
  [/WALL|MURO|MUR\b|WAND/, "walls"],
  [/DOOR|\bDOR\b|PUERTA/, "doors"],
  [/WIND|GLAZ|\bWIN\b|VENT\b|FENST/, "windows"],
  [/ROOM|AREA|SPACE|\bRM\b|IDEN|ZONE/, "rooms"],
];

/** Suggested role for a layer name (and whether it's hidden in the DXF). */
export function suggestRole(name, { off = false, frozen = false } = {}) {
  if (off || frozen) return "ignore";
  const n = String(name || "").toUpperCase();
  for (const [re, role] of RULES) if (re.test(n)) return role;
  return "annotation";
}
