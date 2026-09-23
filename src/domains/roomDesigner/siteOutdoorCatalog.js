// Site/outdoor symbol catalog for the FORGE designer (object library).
//
// Registration site for the "siteOutdoor" symbol domain in the
// domain-extensible symbol registry (see symbolRegistry.js): hardscape
// surfaces, site structures, and landscape elements. Registering the set
// is all it takes — the 2D canvas resolves the domain's draw routine via
// registerDrawRoutine("siteOutdoor", ...) in
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
// Dimensions are nominal planning sizes in inches (width x depth), not
// survey or manufacturer specs.

import { registerSymbolSet } from "./symbolRegistry";

const sym = (id, label, category, glyph, widthIn, depthIn, defaultLayer, color) =>
  Object.freeze({ id, label, category, glyph, widthIn, depthIn, defaultLayer, color });

export const SITE_OUTDOOR_CATEGORIES = Object.freeze([
  "surfaces",
  "structures",
  "landscape",
]);

export const SITE_OUTDOOR_SYMBOLS = Object.freeze([
  // ---- hardscape surfaces ----
  sym("deck", "Deck", "surfaces", "deck", 144, 120, "equipment", "#a3835b"),
  sym("patio", "Patio", "surfaces", "patio", 144, 120, "equipment", "#b8b2a7"),
  sym("driveway", "Driveway", "surfaces", "driveway", 240, 120, "equipment", "#9aa0a8"),
  sym("walkway", "Walkway", "surfaces", "walkway", 120, 48, "equipment", "#b8b2a7"),
  // ---- site structures ----
  sym("fence", "Fence", "structures", "fence", 96, 4, "equipment", "#8a6f4d"),
  sym("shed", "Shed", "structures", "shed", 120, 96, "equipment", "#9a7c55"),
  // ---- landscape ----
  sym("garden-bed", "Garden bed", "landscape", "garden-bed", 96, 48, "equipment", "#7a9a5b"),
  sym("pool-rect", "Rectangular pool", "landscape", "pool-rect", 192, 96, "equipment", "#5eb3d6"),
]);

registerSymbolSet({
  domain: "siteOutdoor",
  title: "Site & outdoor",
  symbols: SITE_OUTDOOR_SYMBOLS.map((s) => ({ ...s })),
});
