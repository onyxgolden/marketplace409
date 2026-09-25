// Process-engineering equipment catalog for the FORGE designer.
//
// Registration site for the "processEquipment" symbol domain in the
// domain-extensible symbol registry (see symbolRegistry.js), following the
// mepFixtures / buildingElements pattern: registering the set is all it
// takes — the 2D canvas resolves the domain's draw routine via
// registerDrawRoutine("processEquipment", ...) in symbolDrawRoutines.jsx,
// placements go through the existing SET_PENDING_SYMBOL -> PLACE_SYMBOL
// pipeline, and instances live in design.symbols.
//
// Entries are DECLARATIVE DATA ONLY:
//   { id, label, category, glyph, widthIn, depthIn, heightIn, shape3d,
//     tagPrefix, defaultLayer, color }
//
// - Names are generic industry terms only (no vendor, model, or
//   site-specific names or codes).
// - Dimensions are nominal PLANNING footprints/heights in inches for layout
//   and clearance studies — not sizing, ratings, or manufacturer specs.
// - tagPrefix is the conventional equipment-tag letter code (P = pump,
//   V = vessel, E = exchanger, ...). A placed piece gets the next free
//   number for its prefix (see equipmentTags.js): P-101, P-102, ...
// - shape3d is the primitive the 3D view extrudes it as:
//     "vcyl" vertical cylinder (diameter = min(width, depth))
//     "hcyl" horizontal cylinder along the width (diameter = depth)
//     "box"  rectangular block

import { registerSymbolSet } from "./symbolRegistry";

export const PROCESS_EQUIPMENT_DOMAIN = "processEquipment";

export const PROCESS_EQUIPMENT_CATEGORIES = Object.freeze([
  "Pumps & compressors",
  "Vessels & tanks",
  "Heat transfer",
  "Separation & filtration",
  "Mixing & handling",
  "Valves & instruments",
]);

export const PROCESS_SHAPES_3D = Object.freeze(["vcyl", "hcyl", "box"]);

const eq = (id, label, category, glyph, widthIn, depthIn, heightIn, shape3d, tagPrefix, color, defaultLayer = "equipment") =>
  Object.freeze({ id, label, category, glyph, widthIn, depthIn, heightIn, shape3d, tagPrefix, defaultLayer, color });

const [PUMPS, VESSELS, HEAT, SEPARATION, HANDLING, VALVES] = PROCESS_EQUIPMENT_CATEGORIES;

export const PROCESS_EQUIPMENT = Object.freeze([
  // ---- pumps & compressors ----
  eq("centrifugal-pump", "Centrifugal pump", PUMPS, "pump-centrifugal", 36, 18, 24, "box", "P", "#60a5fa"),
  eq("pd-pump", "Positive-displacement pump", PUMPS, "pump-pd", 40, 18, 24, "box", "P", "#60a5fa"),
  eq("centrifugal-compressor", "Centrifugal compressor", PUMPS, "compressor-centrifugal", 72, 48, 60, "box", "K", "#818cf8"),
  eq("recip-compressor", "Reciprocating compressor", PUMPS, "compressor-recip", 84, 48, 54, "box", "K", "#818cf8"),
  eq("blower", "Blower / fan", PUMPS, "blower", 36, 36, 36, "box", "K", "#818cf8"),
  // ---- vessels & tanks ----
  eq("vertical-vessel", "Vertical vessel", VESSELS, "vessel-vertical", 48, 48, 120, "vcyl", "V", "#94a3b8"),
  eq("horizontal-drum", "Horizontal drum", VESSELS, "vessel-horizontal", 120, 42, 54, "hcyl", "V", "#94a3b8"),
  eq("storage-tank", "Storage tank (cone roof)", VESSELS, "tank-cone-roof", 144, 144, 144, "vcyl", "TK", "#a1a1aa"),
  eq("column", "Column / tower", VESSELS, "column", 36, 36, 360, "vcyl", "T", "#94a3b8"),
  eq("jacketed-reactor", "Jacketed reactor", VESSELS, "reactor", 60, 60, 96, "vcyl", "R", "#a3a3a3"),
  // ---- heat transfer ----
  eq("shell-tube-exchanger", "Shell-and-tube exchanger", HEAT, "hx-shell-tube", 144, 30, 42, "hcyl", "E", "#f59e0b"),
  eq("plate-exchanger", "Plate exchanger", HEAT, "hx-plate", 30, 48, 66, "box", "E", "#f59e0b"),
  eq("air-cooler", "Air-cooled exchanger", HEAT, "hx-air-cooled", 144, 96, 120, "box", "E", "#fbbf24"),
  eq("fired-heater", "Fired heater", HEAT, "fired-heater", 96, 96, 240, "box", "H", "#f87171"),
  eq("package-boiler", "Package boiler", HEAT, "boiler", 144, 72, 96, "box", "B", "#f87171"),
  eq("cooling-tower", "Cooling tower", HEAT, "cooling-tower", 144, 144, 180, "box", "CT", "#67e8f9"),
  // ---- separation & filtration ----
  eq("cartridge-filter", "Cartridge filter", SEPARATION, "filter", 24, 24, 60, "vcyl", "F", "#86efac"),
  eq("basket-strainer", "Basket strainer", SEPARATION, "strainer", 24, 18, 24, "box", "F", "#86efac"),
  eq("cyclone", "Cyclone separator", SEPARATION, "cyclone", 36, 36, 120, "vcyl", "S", "#86efac"),
  eq("centrifuge", "Centrifuge", SEPARATION, "centrifuge", 60, 48, 60, "box", "S", "#86efac"),
  // ---- mixing & handling ----
  eq("agitated-tank", "Mixing tank with agitator", HANDLING, "agitator-tank", 72, 72, 96, "vcyl", "M", "#c4b5fd"),
  eq("static-mixer", "Static mixer", HANDLING, "static-mixer", 36, 12, 12, "hcyl", "M", "#c4b5fd"),
  eq("belt-conveyor", "Belt conveyor", HANDLING, "conveyor", 240, 36, 36, "box", "CV", "#d6d3d1"),
  eq("hopper", "Hopper / silo", HANDLING, "hopper", 96, 96, 240, "vcyl", "HP", "#d6d3d1"),
  // ---- valves & instruments (inline items: piping layer) ----
  eq("control-valve", "Control valve", VALVES, "control-valve", 18, 18, 18, "box", "FCV", "#e5e7eb", "piping"),
  eq("relief-valve", "Pressure relief valve", VALVES, "relief-valve", 16, 16, 20, "box", "PSV", "#fca5a5", "piping"),
  eq("flow-meter", "Flow meter", VALVES, "flow-meter", 18, 12, 12, "hcyl", "FE", "#e5e7eb", "piping"),
  eq("pressure-gauge", "Pressure gauge", VALVES, "instrument", 12, 12, 12, "box", "PI", "#e5e7eb", "piping"),
]);

registerSymbolSet({
  domain: PROCESS_EQUIPMENT_DOMAIN,
  title: "Process equipment",
  symbols: PROCESS_EQUIPMENT.map((s) => ({ ...s })),
});
