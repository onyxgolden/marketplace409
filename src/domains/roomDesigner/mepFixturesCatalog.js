// MEP fixture symbol catalog for the FORGE designer (object library).
//
// Registration site for the "mepFixtures" symbol domain in the
// domain-extensible symbol registry (see symbolRegistry.js): electrical
// devices and plumbing fixtures placed on the plan. Registering the set
// is all it takes — the 2D canvas resolves the domain's draw routine via
// registerDrawRoutine("mepFixtures", ...) in
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
// Dimensions are nominal planning footprints in inches (width x depth),
// not manufacturer specs. Device symbols (outlet, switch, smoke detector)
// are drawn oversized relative to the physical device so they stay
// legible on the plan — the standard CAD-symbol convention.

import { registerSymbolSet } from "./symbolRegistry";

const sym = (id, label, category, glyph, widthIn, depthIn, defaultLayer, color) =>
  Object.freeze({ id, label, category, glyph, widthIn, depthIn, defaultLayer, color });

export const MEP_FIXTURE_CATEGORIES = Object.freeze([
  "electrical",
  "plumbing",
]);

export const MEP_FIXTURES = Object.freeze([
  // ---- electrical ----
  sym("outlet-duplex", "Duplex outlet", "electrical", "outlet-duplex", 8, 8, "piping", "#e3c878"),
  sym("switch", "Switch", "electrical", "switch", 8, 8, "piping", "#e3c878"),
  sym("smoke-detector", "Smoke detector", "electrical", "smoke-detector", 8, 8, "annotations", "#e0e0e0"),
  sym("load-center", "Load center", "electrical", "load-center", 30, 6, "equipment", "#9aa3ad"),
  // ---- plumbing ----
  sym("hose-bib", "Hose bib", "plumbing", "hose-bib", 8, 8, "piping", "#7fb3d5"),
  sym("floor-drain", "Floor drain", "plumbing", "floor-drain", 12, 12, "piping", "#9aa3ad"),
]);

registerSymbolSet({
  domain: "mepFixtures",
  title: "MEP fixtures",
  symbols: MEP_FIXTURES.map((s) => ({ ...s })),
});
