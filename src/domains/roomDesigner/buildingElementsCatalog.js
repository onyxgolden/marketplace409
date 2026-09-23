// Building-elements symbol catalog for the FORGE designer (object library).
//
// Registration site for the "buildingElements" symbol domain in the
// domain-extensible symbol registry (see symbolRegistry.js): doors,
// windows, stairs, and structural elements. Registering the set is all it
// takes — the 2D canvas resolves the domain's draw routine via
// registerDrawRoutine("buildingElements", ...) in
// src/components/designer/symbolDrawRoutines.jsx, and symbol *instances*
// (placements) live in design.symbols in the document model. Placement
// goes through the existing SET_PENDING_SYMBOL -> PLACE_SYMBOL pipeline
// (shared with the piping domain); the library panel is a view layer.
//
// Catalog entries are DECLARATIVE DATA ONLY: { id, label, category,
// glyph, widthIn, depthIn, defaultLayer, color }. No functions, no dynamic
// imports — only registered symbol routines are callable (see the
// symbolDrawRoutines "glyph" switch for this domain).
//
// Dimensions are nominal US-standard planning sizes in inches (width x
// depth), not manufacturer specs. Doors/windows are drawn at typical
// opening width x wall thickness; stairs at typical run x width.

import { registerSymbolSet } from "./symbolRegistry";

const sym = (id, label, category, glyph, widthIn, depthIn, defaultLayer, color) =>
  Object.freeze({ id, label, category, glyph, widthIn, depthIn, defaultLayer, color });

export const BUILDING_ELEMENT_CATEGORIES = Object.freeze([
  "doors",
  "windows",
  "stairs",
  "structure",
]);

export const BUILDING_ELEMENTS = Object.freeze([
  // ---- doors (36" single is the residential standard; widths are opening widths) ----
  sym("door-single", "Single door", "doors", "door-single", 36, 4, "equipment", "#d6a35c"),
  sym("door-double", "Double door", "doors", "door-double", 72, 4, "equipment", "#d6a35c"),
  sym("door-sliding", "Sliding door", "doors", "door-sliding", 72, 4, "equipment", "#c99a52"),
  sym("door-pocket", "Pocket door", "doors", "door-pocket", 36, 4, "equipment", "#c99a52"),
  sym("door-bifold", "Bifold door", "doors", "door-bifold", 48, 4, "equipment", "#c99a52"),
  // ---- windows (widths are opening widths; 4" nominal wall thickness) ----
  sym("window-single-hung", "Single-hung window", "windows", "window-single", 36, 4, "equipment", "#7fb3d5"),
  sym("window-double-hung", "Double-hung window", "windows", "window-double", 36, 4, "equipment", "#7fb3d5"),
  sym("window-casement", "Casement window", "windows", "window-casement", 36, 4, "equipment", "#7fb3d5"),
  sym("window-sliding", "Sliding window", "windows", "window-sliding", 60, 4, "equipment", "#7fb3d5"),
  sym("window-picture", "Picture window", "windows", "window-picture", 60, 4, "equipment", "#7fb3d5"),
  sym("window-awning", "Awning window", "windows", "window-awning", 36, 4, "equipment", "#7fb3d5"),
  // ---- stairs (42" stair width is the comfortable residential standard) ----
  sym("stairs-straight", "Straight stairs", "stairs", "stairs-straight", 144, 42, "equipment", "#b0a08a"),
  sym("stairs-l", "L-shaped stairs", "stairs", "stairs-l", 120, 120, "equipment", "#b0a08a"),
  sym("stairs-u", "U-shaped stairs", "stairs", "stairs-u", 120, 108, "equipment", "#b0a08a"),
  // ---- structure ----
  sym("railing", "Railing", "structure", "railing", 72, 4, "equipment", "#9aa3ad"),
  sym("column", "Column", "structure", "column", 12, 12, "equipment", "#8d99a6"),
  sym("fireplace", "Fireplace", "structure", "fireplace", 48, 24, "equipment", "#a9714b"),
]);

registerSymbolSet({
  domain: "buildingElements",
  title: "Building elements",
  symbols: BUILDING_ELEMENTS.map((s) => ({ ...s })),
});
