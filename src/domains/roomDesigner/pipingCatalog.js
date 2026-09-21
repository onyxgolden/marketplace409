// Piping symbol catalog for the FORGE designer (Phase 2: piping mode).
//
// This is the registration site for the "piping" symbol domain in the
// domain-extensible symbol registry (see symbolRegistry.js): registering
// the set is all it takes — the 2D canvas resolves the domain's draw
// routine via registerDrawRoutine("piping", ...) in
// src/components/designer/symbolDrawRoutines.jsx, and symbol *instances*
// (placements) live in design.symbols in the document model.
//
// Glyphs are P&ID-inspired 2D marks (valve bowties, pump circle, vessel,
// fittings, flow arrow, equipment tag); sizes are nominal planning sizes
// in inches, not manufacturer specs.

import { registerSymbolSet } from "./symbolRegistry";

const sym = (id, label, glyph, widthIn, depthIn, defaultLayer) =>
  Object.freeze({ id, label, glyph, widthIn, depthIn, defaultLayer, color: "#cbd5e1" });

export const PIPING_SYMBOLS = Object.freeze([
  sym("gate-valve", "Gate valve", "gate", 14, 14, "piping"),
  sym("ball-valve", "Ball valve", "ball", 14, 14, "piping"),
  sym("check-valve", "Check valve", "check", 14, 14, "piping"),
  sym("pump", "Pump", "pump", 26, 20, "equipment"),
  sym("tank", "Tank / vessel", "tank", 40, 52, "equipment"),
  sym("elbow", "Elbow", "elbow", 14, 14, "piping"),
  sym("tee", "Tee", "tee", 16, 16, "piping"),
  sym("reducer", "Reducer", "reducer", 20, 12, "piping"),
  sym("flow-arrow", "Flow arrow", "flow", 20, 12, "annotations"),
  sym("equipment-tag", "Equipment tag", "tag", 30, 16, "annotations"),
]);

registerSymbolSet({
  domain: "piping",
  title: "Piping",
  symbols: PIPING_SYMBOLS.map((s) => ({ ...s })),
});
