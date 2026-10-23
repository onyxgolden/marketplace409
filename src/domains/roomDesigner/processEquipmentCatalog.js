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
//     "vcyl"   vertical cylinder (diameter = min(width, depth))
//     "hcyl"   horizontal cylinder along the width (diameter = depth)
//     "box"    rectangular block
//     "sphere" sphere on legs (diameter = min(width, depth))

import { registerSymbolSet } from "./symbolRegistry";
import { TEMA_CATEGORIES, TEMA_EQUIPMENT } from "./temaExchangerCatalog";

export const PROCESS_EQUIPMENT_DOMAIN = "processEquipment";

export const PROCESS_EQUIPMENT_CATEGORIES = Object.freeze([
  "Pumps",
  "Compressors & vacuum",
  "Drivers",
  "Fired equipment",
  "Heat exchangers",
  "Columns & reactors",
  "Vessels & storage",
  "Separation & filtration",
  "Solids handling",
  "Mixing",
  "Utilities & environmental",
  "Valves & instruments",
  "Structures",
  // Detailed TEMA shell-and-tube entries (temaExchangerCatalog.js).
  ...TEMA_CATEGORIES,
]);

export const PROCESS_SHAPES_3D = Object.freeze(["vcyl", "hcyl", "box", "sphere", "rack"]);

const eq = (id, label, category, glyph, widthIn, depthIn, heightIn, shape3d, tagPrefix, color, defaultLayer = "equipment") =>
  Object.freeze({ id, label, category, glyph, widthIn, depthIn, heightIn, shape3d, tagPrefix, defaultLayer, color });

// Generic nozzle (connection anchor) specs: [id, fx, fy, sizeIn] where
// (fx, fy) are fractions of the instance's half-width / half-depth in
// [-1, 1] (plan frame: +fx = east, +fy = south; (0, 0) is a top/center
// nozzle) and sizeIn is the nominal size in inches. See pipeAttachments.js
// (catalogAnchorsWorld) for the world projection.
const nozzleSet = (...specs) =>
  Object.freeze(specs.map(([id, fx, fy, sizeIn]) => Object.freeze({ id, fx, fy, sizeIn })));

// Manway spec: [fx, fy] position in the nozzle fractional frame,
// diameterIn the opening diameter, sillIn the height of the BOTTOM of
// the opening above the vessel base (grade). See vesselAccess.js for
// the access rule (sill over 24 in gains a catwalk + ladder).
const manwaySpec = (fx, fy, diameterIn, sillIn) =>
  Object.freeze({ fx, fy, diameterIn, sillIn });

const [
  PUMPS, COMPRESSORS, DRIVERS, FIRED, EXCHANGERS, COLUMNS, VESSELS,
  SEPARATION, SOLIDS, MIXING, UTILITIES, VALVES, STRUCTURES,
] = PROCESS_EQUIPMENT_CATEGORIES;

// Colors group by discipline so a plot plan reads at a glance.
const C = {
  pump: "#60a5fa", comp: "#818cf8", drive: "#a78bfa", fired: "#f87171", hx: "#f59e0b",
  column: "#94a3b8", vessel: "#a1a1aa", sep: "#86efac", solids: "#d6d3d1", mix: "#c4b5fd",
  util: "#67e8f9", inst: "#e5e7eb", relief: "#fca5a5",
};

export const PROCESS_EQUIPMENT = Object.freeze([
  // ---- pumps (P) ----
  Object.freeze({
    ...eq("centrifugal-pump", "Centrifugal pump", PUMPS, "pump-centrifugal", 36, 18, 24, "box", "P", C.pump),
    nozzles: nozzleSet(["suction-in", 0, -1, 4], ["discharge-out", 0, 1, 6]),
  }),
  Object.freeze({
    ...eq("pd-pump", "Positive-displacement pump", PUMPS, "pump-pd", 40, 18, 24, "box", "P", C.pump),
    nozzles: nozzleSet(["suction-in", 0, -1, 3], ["discharge-out", 0, 1, 4]),
  }),
  Object.freeze({
    ...eq("vertical-can-pump", "Vertical can pump", PUMPS, "pump-vertical-can", 30, 30, 72, "vcyl", "P", C.pump),
    nozzles: nozzleSet(["suction-in", 0, -1, 4], ["discharge-out", 0, 0, 4]),
  }),
  Object.freeze({
    ...eq("vertical-inline-pump", "Vertical in-line pump", PUMPS, "pump-vertical-inline", 24, 24, 48, "vcyl", "P", C.pump),
    nozzles: nozzleSet(["suction-in", 0, -1, 3], ["discharge-out", 0, 1, 3]),
  }),
  Object.freeze({
    ...eq("submersible-pump", "Submersible pump", PUMPS, "pump-submersible", 18, 18, 36, "vcyl", "P", C.pump),
    nozzles: nozzleSet(["discharge-out", 0, 0, 3]),
  }),
  Object.freeze({
    ...eq("sump-pump", "Sump pump", PUMPS, "pump-sump", 24, 24, 48, "vcyl", "P", C.pump),
    nozzles: nozzleSet(["discharge-out", 0, 0, 3]),
  }),
  Object.freeze({
    ...eq("gear-pump", "Gear pump", PUMPS, "pump-gear", 30, 16, 20, "box", "P", C.pump),
    nozzles: nozzleSet(["suction-in", -1, 0, 2], ["discharge-out", 1, 0, 2]),
  }),
  Object.freeze({
    ...eq("screw-pump", "Screw pump", PUMPS, "pump-screw", 60, 18, 24, "hcyl", "P", C.pump),
    nozzles: nozzleSet(["suction-in", 0, -1, 3], ["discharge-out", 1, 0, 3]),
  }),
  Object.freeze({
    ...eq("metering-pump", "Metering / diaphragm pump", PUMPS, "pump-metering", 24, 18, 30, "box", "P", C.pump),
    nozzles: nozzleSet(["suction-in", -1, 0, 1], ["discharge-out", 1, 0, 1]),
  }),
  Object.freeze({
    ...eq("progressive-cavity-pump", "Progressive cavity pump", PUMPS, "pump-progressive-cavity", 72, 16, 20, "hcyl", "P", C.pump),
    nozzles: nozzleSet(["suction-in", -1, 0, 4], ["discharge-out", 1, 0, 4]),
  }),
  Object.freeze({
    ...eq("plunger-pump", "Reciprocating plunger pump", PUMPS, "pump-plunger", 60, 36, 36, "box", "P", C.pump),
    nozzles: nozzleSet(["suction-in", -1, 0, 3], ["discharge-out", 1, 0, 3]),
  }),

  // ---- compressors & vacuum (K, J) ----
  Object.freeze({
    ...eq("centrifugal-compressor", "Centrifugal compressor", COMPRESSORS, "compressor-centrifugal", 72, 48, 60, "box", "K", C.comp),
    nozzles: nozzleSet(["suction-in", 0, -1, 8], ["discharge-out", 0, 1, 6]),
  }),
  Object.freeze({
    ...eq("recip-compressor", "Reciprocating compressor", COMPRESSORS, "compressor-recip", 84, 48, 54, "box", "K", C.comp),
    nozzles: nozzleSet(["suction-in", 0, -1, 10], ["discharge-out", 0, 1, 8]),
  }),
  Object.freeze({
    ...eq("screw-compressor", "Rotary screw compressor", COMPRESSORS, "compressor-screw", 72, 48, 60, "box", "K", C.comp),
    nozzles: nozzleSet(["suction-in", 0, -1, 8], ["discharge-out", 0, 1, 6]),
  }),
  Object.freeze({
    ...eq("axial-compressor", "Axial compressor", COMPRESSORS, "compressor-axial", 120, 60, 72, "hcyl", "K", C.comp),
    nozzles: nozzleSet(["suction-in", -1, 0, 16], ["discharge-out", 1, 0, 14]),
  }),
  Object.freeze({
    ...eq("blower", "Blower / fan", COMPRESSORS, "blower", 36, 36, 36, "box", "K", C.comp),
    nozzles: nozzleSet(["intake-in", -1, 0, 12], ["discharge-out", 1, 0, 16]),
  }),
  Object.freeze({
    ...eq("rotary-lobe-blower", "Rotary lobe blower", COMPRESSORS, "blower-lobe", 48, 30, 36, "box", "K", C.comp),
    nozzles: nozzleSet(["intake-in", 0, -1, 8], ["discharge-out", 0, 1, 8]),
  }),
  Object.freeze({
    ...eq("liquid-ring-vacuum-pump", "Liquid-ring vacuum pump", COMPRESSORS, "vacuum-liquid-ring", 48, 30, 36, "box", "K", C.comp),
    nozzles: nozzleSet(["suction-in", 0, -1, 6], ["discharge-out", 0, 1, 4]),
  }),
  Object.freeze({
    ...eq("steam-ejector", "Steam-jet ejector", COMPRESSORS, "ejector", 72, 12, 12, "hcyl", "J", C.comp),
    nozzles: nozzleSet(["motive-in", -1, 0, 3], ["suction-in", 0, -1, 6], ["discharge-out", 1, 0, 8]),
  }),
  Object.freeze({
    ...eq("instrument-air-package", "Instrument air package", COMPRESSORS, "air-package", 96, 60, 72, "box", "K", C.comp),
    nozzles: nozzleSet(["intake-in", -1, 0, 6], ["air-out", 1, 0, 3]),
  }),

  // ---- drivers ----
  eq("electric-motor", "Electric motor", DRIVERS, "motor", 36, 24, 24, "hcyl", "M", C.drive),
  Object.freeze({
    ...eq("steam-turbine", "Steam turbine", DRIVERS, "turbine-steam", 96, 60, 72, "box", "ST", C.drive),
    nozzles: nozzleSet(["steam-in", 0, -1, 8], ["exhaust-out", 0, 1, 12]),
  }),
  Object.freeze({
    ...eq("gas-turbine", "Gas turbine", DRIVERS, "turbine-gas", 240, 96, 120, "box", "GT", C.drive),
    nozzles: nozzleSet(["fuel-in", -1, 0, 2], ["exhaust-out", 1, 0, 24]),
  }),
  Object.freeze({
    ...eq("turboexpander", "Turboexpander", DRIVERS, "expander", 60, 48, 60, "box", "EX", C.drive),
    nozzles: nozzleSet(["gas-in", -1, 0, 8], ["gas-out", 1, 0, 10]),
  }),
  Object.freeze({
    ...eq("diesel-engine", "Diesel engine", DRIVERS, "engine-diesel", 96, 48, 60, "box", "DE", C.drive),
    nozzles: nozzleSet(["fuel-in", -1, 0, 1], ["exhaust-out", 0, -1, 6]),
  }),
  eq("gearbox", "Gearbox", DRIVERS, "gearbox", 36, 36, 36, "box", "GB", C.drive),

  // ---- fired equipment (H, B, ...) ----
  Object.freeze({
    ...eq("fired-heater", "Fired heater (box type)", FIRED, "fired-heater", 96, 96, 240, "box", "H", C.fired),
    nozzles: nozzleSet(["feed-in", -1, 0, 8], ["outlet-out", 1, 0, 8]),
  }),
  Object.freeze({
    ...eq("cylindrical-heater", "Fired heater (cylindrical)", FIRED, "heater-cylindrical", 120, 120, 360, "vcyl", "H", C.fired),
    nozzles: nozzleSet(["feed-in", -1, 0, 8], ["outlet-out", 1, 0, 8]),
  }),
  Object.freeze({
    ...eq("reformer-furnace", "Reformer furnace", FIRED, "furnace-reformer", 360, 240, 480, "box", "H", C.fired),
    nozzles: nozzleSet(["feed-in", -1, 0, 10], ["outlet-out", 1, 0, 10]),
  }),
  Object.freeze({
    ...eq("cracking-furnace", "Cracking furnace", FIRED, "furnace-cracking", 300, 180, 480, "box", "H", C.fired),
    nozzles: nozzleSet(["feed-in", -1, 0, 10], ["outlet-out", 1, 0, 10]),
  }),
  Object.freeze({
    ...eq("package-boiler", "Package boiler (water-tube)", FIRED, "boiler", 144, 72, 96, "box", "B", C.fired),
    nozzles: nozzleSet(["steam-out", 0, 0, 10], ["feedwater-in", 1, 0, 4], ["blowdown-out", 0, 1, 2]),
  }),
  Object.freeze({
    ...eq("firetube-boiler", "Fire-tube boiler", FIRED, "boiler-firetube", 180, 84, 96, "hcyl", "B", C.fired),
    nozzles: nozzleSet(["steam-out", 0, -1, 8], ["feedwater-in", 1, 0, 4]),
  }),
  Object.freeze({
    ...eq("waste-heat-boiler", "Waste-heat boiler (HRSG)", FIRED, "boiler-waste-heat", 360, 180, 480, "box", "WHB", C.fired),
    nozzles: nozzleSet(["gas-in", -1, 0, 24], ["gas-out", 1, 0, 24], ["steam-out", 0, -1, 12]),
  }),
  Object.freeze({
    ...eq("thermal-oxidizer", "Thermal oxidizer / incinerator", FIRED, "thermal-oxidizer", 240, 96, 120, "hcyl", "TO", C.fired),
    nozzles: nozzleSet(["inlet-in", -1, 0, 16], ["exhaust-out", 1, 0, 16]),
  }),
  Object.freeze({
    ...eq("flare-stack", "Flare stack", FIRED, "flare", 36, 36, 1200, "vcyl", "FL", C.fired),
    nozzles: nozzleSet(["relief-in", -1, 0, 24]),
  }),
  Object.freeze({
    ...eq("stack", "Stack / chimney", FIRED, "stack", 60, 60, 900, "vcyl", "STK", C.fired),
    nozzles: nozzleSet(["inlet-in", 0, 1, 24]),
  }),

  // ---- heat exchangers (E) ----
  Object.freeze({
    ...eq("shell-tube-exchanger", "Shell-and-tube exchanger", EXCHANGERS, "hx-shell-tube", 144, 30, 42, "hcyl", "E", C.hx),
    nozzles: nozzleSet(
      ["tube-in", -1, 0, 8],
      ["tube-out", 1, 0, 8],
      ["shell-in", 0.5, -1, 12],
      ["shell-out", -0.5, -1, 12],
      ["cooling-water-in", -0.5, 1, 10],
      ["cooling-water-out", 0.5, 1, 10],
    ),
  }),
  Object.freeze({
    ...eq("kettle-reboiler", "Kettle reboiler", EXCHANGERS, "hx-kettle", 180, 60, 72, "hcyl", "E", C.hx),
    nozzles: nozzleSet(["process-in", -1, 0, 8], ["process-out", 1, 0, 8], ["steam-in", 0, -1, 6], ["condensate-out", 0, 1, 6]),
  }),
  Object.freeze({
    ...eq("double-pipe-exchanger", "Double-pipe (hairpin) exchanger", EXCHANGERS, "hx-double-pipe", 180, 24, 36, "box", "E", C.hx),
    nozzles: nozzleSet(["process-in", -1, 0, 4], ["process-out", 1, 0, 4], ["service-in", 0, -1, 3], ["service-out", 0, 1, 3]),
  }),
  Object.freeze({
    ...eq("plate-exchanger", "Plate exchanger", EXCHANGERS, "hx-plate", 30, 48, 66, "box", "E", C.hx),
    nozzles: nozzleSet(["process-in", -0.5, -1, 4], ["process-out", 0.5, 1, 4], ["service-in", 0.5, -1, 4], ["service-out", -0.5, 1, 4]),
  }),
  Object.freeze({
    ...eq("spiral-exchanger", "Spiral exchanger", EXCHANGERS, "hx-spiral", 48, 48, 60, "vcyl", "E", C.hx),
    nozzles: nozzleSet(["process-in", 0, -1, 6], ["process-out", 0, 1, 6]),
  }),
  Object.freeze({
    ...eq("plate-fin-exchanger", "Plate-fin exchanger (cold box)", EXCHANGERS, "hx-plate-fin", 48, 48, 120, "box", "E", C.hx),
    nozzles: nozzleSet(["feed-in", -1, 0, 8], ["product-out", 1, 0, 8]),
  }),
  Object.freeze({
    ...eq("surface-condenser", "Surface condenser", EXCHANGERS, "hx-condenser", 240, 96, 120, "hcyl", "E", C.hx),
    nozzles: nozzleSet(["vapor-in", 0, -1, 16], ["condensate-out", 0, 1, 8], ["cooling-water-in", -1, 0, 12], ["cooling-water-out", 1, 0, 12]),
  }),
  Object.freeze({
    ...eq("air-cooler", "Air-cooled exchanger", EXCHANGERS, "hx-air-cooled", 144, 96, 120, "box", "E", C.hx),
    nozzles: nozzleSet(["process-in", -1, 0, 8], ["process-out", 1, 0, 8]),
  }),
  Object.freeze({
    ...eq("electric-process-heater", "Electric process heater", EXCHANGERS, "heater-electric", 96, 36, 36, "hcyl", "E", C.hx),
    nozzles: nozzleSet(["process-in", -1, 0, 6], ["process-out", 1, 0, 6]),
  }),

  // ---- columns & reactors (T, R) ----
  Object.freeze({
    ...eq("column", "Column / tower (trayed)", COLUMNS, "column", 36, 36, 360, "vcyl", "T", C.column),
    nozzles: nozzleSet(
      ["feed-in", -1, 0, 16],
      ["overhead-out", 0, 1, 10],
      ["bottoms-out", -0.7071, 0.7071, 12],
      ["reflux-in", 0.7071, 0.7071, 6],
      ["rich-oil-in", 1, 0, 6],
      ["relief-out", 0.7071, -0.7071, 12],
    ),
    downcomers: true,
  }),
  Object.freeze({
    ...eq("packed-column", "Packed column", COLUMNS, "column-packed", 48, 48, 480, "vcyl", "T", C.column),
    nozzles: nozzleSet(["feed-in", -1, 0, 16], ["overhead-out", 0, 0, 10], ["bottoms-out", 0, 1, 12], ["reflux-in", 1, 0, 6]),
    downcomers: true,
  }),
  Object.freeze({
    ...eq("absorber", "Absorber", COLUMNS, "column-absorber", 60, 60, 480, "vcyl", "T", C.column),
    nozzles: nozzleSet(
      ["gas-in", 0, 1, 6],
      ["rich-oil-out", -1, 0, 6],
      ["lean-oil-in", 0, -1, 6],
      ["vapor-out", 0, 0, 6],
    ),
    downcomers: true,
  }),
  Object.freeze({
    ...eq("stripper", "Stripper", COLUMNS, "column-stripper", 42, 42, 360, "vcyl", "T", C.column),
    nozzles: nozzleSet(["feed-in", -1, 0, 12], ["overhead-out", 0, 0, 8], ["bottoms-out", 0, 1, 10], ["steam-in", 0, -1, 6]),
    downcomers: true,
  }),
  Object.freeze({
    ...eq("vacuum-column", "Vacuum column", COLUMNS, "column-vacuum", 120, 120, 480, "vcyl", "T", C.column),
    nozzles: nozzleSet(["feed-in", -1, 0, 20], ["vapor-out", 0, 0, 16], ["bottoms-out", 0, 1, 14]),
    downcomers: true,
  }),
  Object.freeze({
    ...eq("jacketed-reactor", "Jacketed reactor (stirred tank)", COLUMNS, "reactor", 60, 60, 96, "vcyl", "R", C.column),
    nozzles: nozzleSet(["feed-in", 0, 0, 6], ["product-out", 0, 1, 6], ["jacket-in", -1, 0, 3], ["jacket-out", 1, 0, 3]),
  }),
  Object.freeze({
    ...eq("fixed-bed-reactor", "Fixed-bed reactor", COLUMNS, "reactor-fixed-bed", 96, 96, 360, "vcyl", "R", C.column),
    nozzles: nozzleSet(["feed-in", 0, -1, 12], ["effluent-out", 0, 1, 12]),
  }),
  Object.freeze({
    ...eq("fluidized-bed-reactor", "Fluidized-bed reactor", COLUMNS, "reactor-fluidized", 144, 144, 480, "vcyl", "R", C.column),
    nozzles: nozzleSet(
      ["feed-in", 0, 1, 8],
      ["effluent-out", 1, 0, 16],
      ["spent-catalyst-out", 0.7071, 0.7071, 10],
      ["regen-catalyst-in", 0.7071, -0.7071, 10],
      ["relief-out", 0, -1, 12],
    ),
  }),
  Object.freeze({
    ...eq("catalyst-regenerator", "Catalyst regenerator", COLUMNS, "regenerator", 180, 180, 480, "vcyl", "R", C.column),
    nozzles: nozzleSet(
      ["spent-catalyst-in", -0.7071, 0.7071, 10],
      ["regen-catalyst-out", -0.7071, -0.7071, 10],
      ["flue-gas-out", 0, -1, 12],
      ["air-in", 0, 1, 16],
      ["relief-out", 1, 0, 12],
    ),
  }),
  Object.freeze({
    ...eq("tubular-reactor", "Tubular reactor", COLUMNS, "reactor-tubular", 240, 48, 60, "box", "R", C.column),
    nozzles: nozzleSet(["feed-in", -1, 0, 8], ["product-out", 1, 0, 8]),
  }),

  // ---- vessels & storage (V, TK) ----
  Object.freeze({
    ...eq("vertical-vessel", "Vertical vessel", VESSELS, "vessel-vertical", 48, 48, 120, "vcyl", "V", C.vessel),
    nozzles: nozzleSet(["top-out", 0, 0, 8], ["side-in", -1, 0, 10], ["side-out", 1, 0, 8], ["bottom-out", 0.45, 0.45, 6]),
    manway: manwaySpec(0, 1, 24, 30),
  }),
  Object.freeze({
    ...eq("horizontal-drum", "Horizontal drum", VESSELS, "vessel-horizontal", 120, 42, 54, "hcyl", "V", C.vessel),
    nozzles: nozzleSet(
      ["inlet", 0, -1, 10],
      ["liquid-out", -1, 0, 6],
      ["wet-gas-out", -1, -0.5, 8],
      ["vapor-out", 1, 0, 8],
    ),
    manway: manwaySpec(-1, 0, 20, 18),
  }),
  Object.freeze({
    ...eq("knockout-drum", "Knockout drum", VESSELS, "drum-knockout", 72, 72, 144, "vcyl", "V", C.vessel),
    nozzles: nozzleSet(
      ["gas-in", 1, 0, 8],
      ["gas-out", 0, 1, 8],
      ["liquid-out", -0.7071, 0.7071, 4],
    ),
    manway: manwaySpec(0, 1, 24, 30),
  }),
  Object.freeze({
    ...eq("three-phase-separator", "Three-phase separator", VESSELS, "separator-three-phase", 240, 72, 96, "hcyl", "V", C.vessel),
    nozzles: nozzleSet(["inlet-in", 0, -1, 12], ["gas-out", 1, 0, 10], ["oil-out", -1, 0, 8], ["water-out", -0.5, 1, 6]),
    manway: manwaySpec(-1, 0, 24, 24),
  }),
  Object.freeze({
    ...eq("reflux-accumulator", "Reflux accumulator", VESSELS, "accumulator", 144, 48, 72, "hcyl", "V", C.vessel),
    nozzles: nozzleSet(["inlet-in", 0, -1, 8], ["liquid-out", -1, 0, 6], ["vapor-out", 1, 0, 6]),
    manway: manwaySpec(-1, 0, 20, 18),
  }),
  Object.freeze({
    ...eq("storage-tank", "Storage tank (cone roof)", VESSELS, "tank-cone-roof", 144, 144, 144, "vcyl", "TK", C.vessel),
    nozzles: nozzleSet(["top-in", 0, 0, 12], ["side-out", 0, 1, 12]),
    manway: manwaySpec(0, 1, 30, 6),
  }),
  Object.freeze({
    ...eq("dome-roof-tank", "Storage tank (dome roof)", VESSELS, "tank-dome-roof", 240, 240, 360, "vcyl", "TK", C.vessel),
    nozzles: nozzleSet(["top-in", 0, 0, 16], ["side-out", 0, 1, 16]),
    manway: manwaySpec(0, 1, 30, 6),
  }),
  Object.freeze({
    ...eq("floating-roof-tank", "Storage tank (floating roof)", VESSELS, "tank-floating-roof", 360, 360, 480, "vcyl", "TK", C.vessel),
    nozzles: nozzleSet(["top-in", 0, 0, 20], ["side-out", 0, 1, 20]),
    manway: manwaySpec(0, 1, 30, 6),
  }),
  Object.freeze({
    ...eq("pressure-sphere", "Pressure storage sphere", VESSELS, "sphere", 360, 360, 420, "sphere", "TK", C.vessel),
    nozzles: nozzleSet(["top-out", 0, 0, 10], ["side-in", -1, 0, 12], ["bottom-out", 0.4, 0.4, 12]),
    manway: manwaySpec(0.4, 0.4, 24, 36),
  }),
  Object.freeze({
    ...eq("lpg-bullet", "Pressurized bullet (LPG)", VESSELS, "bullet", 480, 120, 156, "hcyl", "TK", C.vessel),
    nozzles: nozzleSet(["inlet-in", 0, -1, 12], ["liquid-out", -1, 0, 10], ["vapor-out", 1, 0, 10]),
    manway: manwaySpec(-1, 0, 20, 30),
  }),
  Object.freeze({
    ...eq("day-tank", "Day tank", VESSELS, "tank-day", 60, 60, 72, "vcyl", "TK", C.vessel),
    nozzles: nozzleSet(["top-in", 0, 0, 6], ["side-out", 0, 1, 6]),
    manway: manwaySpec(0, 1, 24, 6),
  }),

  // ---- separation & filtration (F, S, ...) ----
  Object.freeze({
    ...eq("cartridge-filter", "Cartridge filter", SEPARATION, "filter", 24, 24, 60, "vcyl", "F", C.sep),
    nozzles: nozzleSet(["inlet-in", -1, 0, 3], ["outlet-out", 1, 0, 3]),
  }),
  Object.freeze({
    ...eq("basket-strainer", "Basket strainer", SEPARATION, "strainer", 24, 18, 24, "box", "F", C.sep),
    nozzles: nozzleSet(["inlet-in", -1, 0, 3], ["outlet-out", 1, 0, 3]),
  }),
  Object.freeze({
    ...eq("cyclone", "Cyclone separator", SEPARATION, "cyclone", 36, 36, 120, "vcyl", "S", C.sep),
    nozzles: nozzleSet(["feed-in", -1, -0.5, 8], ["overflow-out", 0, 0, 6], ["underflow-out", 0.4, 0.4, 4]),
  }),
  Object.freeze({
    ...eq("centrifuge", "Centrifuge", SEPARATION, "centrifuge", 60, 48, 60, "box", "S", C.sep),
    nozzles: nozzleSet(["feed-in", 0, -1, 6], ["liquid-out", 1, 0, 6], ["solids-out", 0, 1, 6]),
  }),
  Object.freeze({
    ...eq("coalescer", "Coalescer", SEPARATION, "coalescer", 120, 36, 48, "hcyl", "S", C.sep),
    nozzles: nozzleSet(["inlet-in", -1, 0, 8], ["oil-out", 1, 0, 8], ["water-out", 0, 1, 4]),
  }),
  Object.freeze({
    ...eq("desalter", "Desalter", SEPARATION, "desalter", 360, 144, 180, "hcyl", "S", C.sep),
    nozzles: nozzleSet(["oil-in", -1, 0, 16], ["oil-out", 1, 0, 16], ["water-out", 0, 1, 8]),
  }),
  Object.freeze({
    ...eq("desiccant-dryer", "Desiccant dryer (twin tower)", SEPARATION, "dryer-desiccant", 72, 36, 120, "box", "DR", C.sep),
    nozzles: nozzleSet(["gas-in", -1, 0, 8], ["gas-out", 1, 0, 8]),
  }),
  Object.freeze({
    ...eq("evaporator", "Evaporator", SEPARATION, "evaporator", 72, 72, 240, "vcyl", "EV", C.sep),
    nozzles: nozzleSet(["feed-in", -1, 0, 8], ["vapor-out", 0, 0, 10], ["product-out", 0, 1, 8]),
  }),
  Object.freeze({
    ...eq("crystallizer", "Crystallizer", SEPARATION, "crystallizer", 96, 96, 180, "vcyl", "CZ", C.sep),
    nozzles: nozzleSet(["feed-in", -1, 0, 8], ["slurry-out", 0, 1, 10], ["vapor-out", 0, 0, 8]),
  }),
  Object.freeze({
    ...eq("filter-press", "Filter press", SEPARATION, "filter-press", 180, 60, 72, "box", "F", C.sep),
    nozzles: nozzleSet(["feed-in", -1, 0, 6], ["filtrate-out", 1, 0, 6]),
  }),
  Object.freeze({
    ...eq("baghouse", "Baghouse (fabric filter)", SEPARATION, "baghouse", 144, 96, 240, "box", "F", C.sep),
    nozzles: nozzleSet(["gas-in", 0, 1, 16], ["gas-out", 0, -1, 16]),
  }),
  Object.freeze({
    ...eq("electrostatic-precipitator", "Electrostatic precipitator", SEPARATION, "precipitator", 240, 144, 300, "box", "ESP", C.sep),
    nozzles: nozzleSet(["gas-in", -1, 0, 20], ["gas-out", 1, 0, 20]),
  }),
  Object.freeze({
    ...eq("wet-scrubber", "Wet scrubber", SEPARATION, "scrubber", 60, 60, 240, "vcyl", "SC", C.sep),
    nozzles: nozzleSet(["gas-in", 0, 1, 12], ["gas-out", 0, 0, 14], ["liquid-out", 0.4, 0.4, 4]),
  }),

  // ---- solids handling ----
  Object.freeze({
    ...eq("belt-conveyor", "Belt conveyor", SOLIDS, "conveyor", 240, 36, 36, "box", "CV", C.solids),
    nozzles: nozzleSet(["feed-in", -1, 0, 12], ["discharge-out", 1, 0, 12]),
  }),
  Object.freeze({
    ...eq("screw-conveyor", "Screw conveyor", SOLIDS, "conveyor-screw", 240, 18, 24, "hcyl", "CV", C.solids),
    nozzles: nozzleSet(["feed-in", -1, 0, 10], ["discharge-out", 1, 0, 10]),
  }),
  Object.freeze({
    ...eq("bucket-elevator", "Bucket elevator", SOLIDS, "elevator-bucket", 36, 24, 480, "box", "CV", C.solids),
    nozzles: nozzleSet(["feed-in", 0, 1, 10], ["discharge-out", 0, -1, 10]),
  }),
  Object.freeze({
    ...eq("rotary-valve", "Rotary valve (airlock)", SOLIDS, "rotary-valve", 18, 18, 24, "box", "RV", C.solids),
    nozzles: nozzleSet(["inlet-in", 0, 0, 8], ["outlet-out", 0.4, 0.4, 8]),
  }),
  Object.freeze({
    ...eq("crusher", "Crusher", SOLIDS, "crusher", 72, 60, 72, "box", "CR", C.solids),
    nozzles: nozzleSet(["feed-in", 0, 0, 12], ["discharge-out", 0.4, 0.4, 12]),
  }),
  Object.freeze({
    ...eq("ball-mill", "Ball mill", SOLIDS, "mill", 240, 96, 120, "hcyl", "ML", C.solids),
    nozzles: nozzleSet(["feed-in", -1, 0, 10], ["discharge-out", 1, 0, 10]),
  }),
  Object.freeze({
    ...eq("weigh-feeder", "Weigh feeder", SOLIDS, "weigh-feeder", 60, 36, 48, "box", "WF", C.solids),
    nozzles: nozzleSet(["feed-in", -1, 0, 8], ["discharge-out", 1, 0, 8]),
  }),
  Object.freeze({
    ...eq("hopper", "Hopper / silo", SOLIDS, "hopper", 96, 96, 240, "vcyl", "HP", C.solids),
    nozzles: nozzleSet(["feed-in", 0, 0, 16], ["discharge-out", 0.4, 0.4, 10]),
  }),

  // ---- mixing (AG, MX) ----
  Object.freeze({
    ...eq("agitated-tank", "Mixing tank with agitator", MIXING, "agitator-tank", 72, 72, 96, "vcyl", "AG", C.mix),
    nozzles: nozzleSet(["feed-in", 0, 0, 8], ["product-out", 0, 1, 8]),
  }),
  Object.freeze({
    ...eq("static-mixer", "Static mixer", MIXING, "static-mixer", 36, 12, 12, "hcyl", "MX", C.mix),
    nozzles: nozzleSet(["inlet-in", -1, 0, 4], ["outlet-out", 1, 0, 4]),
  }),
  Object.freeze({
    ...eq("inline-dynamic-mixer", "In-line dynamic mixer", MIXING, "mixer-inline", 36, 24, 24, "box", "MX", C.mix),
    nozzles: nozzleSet(["inlet-in", -1, 0, 4], ["outlet-out", 1, 0, 4]),
  }),
  Object.freeze({
    ...eq("ribbon-blender", "Ribbon blender", MIXING, "blender-ribbon", 120, 48, 60, "box", "MX", C.mix),
    nozzles: nozzleSet(["feed-in", 0, 0, 10], ["discharge-out", 0.4, 0.4, 10]),
  }),

  // ---- utilities & environmental ----
  Object.freeze({
    ...eq("cooling-tower", "Cooling tower", UTILITIES, "cooling-tower", 144, 144, 180, "box", "CT", C.util),
    nozzles: nozzleSet(["water-in", 0, -1, 12], ["water-out", 0, 1, 12]),
  }),
  Object.freeze({
    ...eq("chiller-package", "Chiller package", UTILITIES, "chiller", 120, 60, 72, "box", "CH", C.util),
    nozzles: nozzleSet(["chilled-water-in", -1, 0, 8], ["chilled-water-out", 1, 0, 8], ["condenser-in", 0, -1, 8], ["condenser-out", 0, 1, 8]),
  }),
  Object.freeze({
    ...eq("deaerator", "Deaerator", UTILITIES, "deaerator", 144, 60, 96, "hcyl", "DA", C.util),
    nozzles: nozzleSet(["water-in", -1, 0, 8], ["water-out", 1, 0, 8], ["steam-in", 0, -1, 6], ["vent-out", 0, 0, 3]),
  }),
  Object.freeze({
    ...eq("water-treatment-skid", "Water treatment skid", UTILITIES, "water-treatment", 120, 60, 96, "box", "WT", C.util),
    nozzles: nozzleSet(["raw-water-in", -1, 0, 6], ["treated-out", 1, 0, 6]),
  }),
  Object.freeze({
    ...eq("api-separator", "API oil-water separator", UTILITIES, "api-separator", 480, 120, 72, "box", "S", C.util),
    nozzles: nozzleSet(["inlet-in", -1, 0, 12], ["oil-out", 1, 0, 10], ["water-out", 0.5, 1, 8]),
  }),

  // ---- valves & instruments (inline items: piping layer) ----
  eq("control-valve", "Control valve", VALVES, "control-valve", 18, 18, 18, "box", "FCV", C.inst, "piping"),
  eq("shutdown-valve", "On-off shutdown valve", VALVES, "valve-shutdown", 18, 18, 24, "box", "XV", C.inst, "piping"),
  eq("motor-operated-valve", "Motor-operated valve", VALVES, "valve-motor-operated", 18, 18, 30, "box", "MOV", C.inst, "piping"),
  eq("relief-valve", "Pressure relief valve", VALVES, "relief-valve", 16, 16, 20, "box", "PSV", C.relief, "piping"),
  eq("rupture-disc", "Rupture disc", VALVES, "rupture-disc", 12, 12, 6, "box", "PSE", C.relief, "piping"),
  eq("flow-meter", "Flow meter", VALVES, "flow-meter", 18, 12, 12, "hcyl", "FE", C.inst, "piping"),
  eq("pressure-gauge", "Pressure gauge", VALVES, "instrument", 12, 12, 12, "box", "PI", C.inst, "piping"),
  eq("temperature-element", "Temperature element", VALVES, "instrument-temperature", 12, 12, 12, "box", "TE", C.inst, "piping"),
  eq("level-gauge", "Level gauge", VALVES, "instrument-level", 8, 8, 36, "box", "LG", C.inst, "piping"),
  eq("process-analyzer", "Process analyzer", VALVES, "analyzer", 36, 36, 84, "box", "AT", C.inst),

  // ---- structures: parametric steel (see rackGeometry.js). widthIn x
  // depthIn = rack length x width; heightIn is nominal — the real height
  // follows the rack's tiers and top-of-steel elevation. ----
  Object.freeze({
    ...eq("pipe-rack", "Pipe rack", STRUCTURES, "pipe-rack", 480, 240, 252, "rack", "PR", "#94a3b8"),
    rack: Object.freeze({ kind: "pipe", tiers: 2, elevationIn: 180, tierSpacingIn: 72, bentSpacingIn: 240 }),
  }),
  Object.freeze({
    ...eq("sleeper-rack", "Sleeper rack", STRUCTURES, "sleeper-rack", 480, 120, 18, "rack", "SL", "#a8a29e"),
    rack: Object.freeze({ kind: "sleeper", tiers: 1, elevationIn: 18, tierSpacingIn: 72, bentSpacingIn: 120 }),
  }),

  // ---- TEMA shell-and-tube exchangers: detailed, configurable ----
  ...TEMA_EQUIPMENT,
]);

registerSymbolSet({
  domain: PROCESS_EQUIPMENT_DOMAIN,
  title: "Process equipment",
  symbols: PROCESS_EQUIPMENT.map((s) => ({ ...s })),
});
