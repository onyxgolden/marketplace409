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
]);

export const PROCESS_SHAPES_3D = Object.freeze(["vcyl", "hcyl", "box", "sphere"]);

const eq = (id, label, category, glyph, widthIn, depthIn, heightIn, shape3d, tagPrefix, color, defaultLayer = "equipment") =>
  Object.freeze({ id, label, category, glyph, widthIn, depthIn, heightIn, shape3d, tagPrefix, defaultLayer, color });

const [
  PUMPS, COMPRESSORS, DRIVERS, FIRED, EXCHANGERS, COLUMNS, VESSELS,
  SEPARATION, SOLIDS, MIXING, UTILITIES, VALVES,
] = PROCESS_EQUIPMENT_CATEGORIES;

// Colors group by discipline so a plot plan reads at a glance.
const C = {
  pump: "#60a5fa", comp: "#818cf8", drive: "#a78bfa", fired: "#f87171", hx: "#f59e0b",
  column: "#94a3b8", vessel: "#a1a1aa", sep: "#86efac", solids: "#d6d3d1", mix: "#c4b5fd",
  util: "#67e8f9", inst: "#e5e7eb", relief: "#fca5a5",
};

export const PROCESS_EQUIPMENT = Object.freeze([
  // ---- pumps (P) ----
  eq("centrifugal-pump", "Centrifugal pump", PUMPS, "pump-centrifugal", 36, 18, 24, "box", "P", C.pump),
  eq("pd-pump", "Positive-displacement pump", PUMPS, "pump-pd", 40, 18, 24, "box", "P", C.pump),
  eq("vertical-can-pump", "Vertical can pump", PUMPS, "pump-vertical-can", 30, 30, 72, "vcyl", "P", C.pump),
  eq("vertical-inline-pump", "Vertical in-line pump", PUMPS, "pump-vertical-inline", 24, 24, 48, "vcyl", "P", C.pump),
  eq("submersible-pump", "Submersible pump", PUMPS, "pump-submersible", 18, 18, 36, "vcyl", "P", C.pump),
  eq("sump-pump", "Sump pump", PUMPS, "pump-sump", 24, 24, 48, "vcyl", "P", C.pump),
  eq("gear-pump", "Gear pump", PUMPS, "pump-gear", 30, 16, 20, "box", "P", C.pump),
  eq("screw-pump", "Screw pump", PUMPS, "pump-screw", 60, 18, 24, "hcyl", "P", C.pump),
  eq("metering-pump", "Metering / diaphragm pump", PUMPS, "pump-metering", 24, 18, 30, "box", "P", C.pump),
  eq("progressive-cavity-pump", "Progressive cavity pump", PUMPS, "pump-progressive-cavity", 72, 16, 20, "hcyl", "P", C.pump),
  eq("plunger-pump", "Reciprocating plunger pump", PUMPS, "pump-plunger", 60, 36, 36, "box", "P", C.pump),

  // ---- compressors & vacuum (K, J) ----
  eq("centrifugal-compressor", "Centrifugal compressor", COMPRESSORS, "compressor-centrifugal", 72, 48, 60, "box", "K", C.comp),
  eq("recip-compressor", "Reciprocating compressor", COMPRESSORS, "compressor-recip", 84, 48, 54, "box", "K", C.comp),
  eq("screw-compressor", "Rotary screw compressor", COMPRESSORS, "compressor-screw", 72, 48, 60, "box", "K", C.comp),
  eq("axial-compressor", "Axial compressor", COMPRESSORS, "compressor-axial", 120, 60, 72, "hcyl", "K", C.comp),
  eq("blower", "Blower / fan", COMPRESSORS, "blower", 36, 36, 36, "box", "K", C.comp),
  eq("rotary-lobe-blower", "Rotary lobe blower", COMPRESSORS, "blower-lobe", 48, 30, 36, "box", "K", C.comp),
  eq("liquid-ring-vacuum-pump", "Liquid-ring vacuum pump", COMPRESSORS, "vacuum-liquid-ring", 48, 30, 36, "box", "K", C.comp),
  eq("steam-ejector", "Steam-jet ejector", COMPRESSORS, "ejector", 72, 12, 12, "hcyl", "J", C.comp),
  eq("instrument-air-package", "Instrument air package", COMPRESSORS, "air-package", 96, 60, 72, "box", "K", C.comp),

  // ---- drivers ----
  eq("electric-motor", "Electric motor", DRIVERS, "motor", 36, 24, 24, "hcyl", "M", C.drive),
  eq("steam-turbine", "Steam turbine", DRIVERS, "turbine-steam", 96, 60, 72, "box", "ST", C.drive),
  eq("gas-turbine", "Gas turbine", DRIVERS, "turbine-gas", 240, 96, 120, "box", "GT", C.drive),
  eq("turboexpander", "Turboexpander", DRIVERS, "expander", 60, 48, 60, "box", "EX", C.drive),
  eq("diesel-engine", "Diesel engine", DRIVERS, "engine-diesel", 96, 48, 60, "box", "DE", C.drive),
  eq("gearbox", "Gearbox", DRIVERS, "gearbox", 36, 36, 36, "box", "GB", C.drive),

  // ---- fired equipment (H, B, ...) ----
  eq("fired-heater", "Fired heater (box type)", FIRED, "fired-heater", 96, 96, 240, "box", "H", C.fired),
  eq("cylindrical-heater", "Fired heater (cylindrical)", FIRED, "heater-cylindrical", 120, 120, 360, "vcyl", "H", C.fired),
  eq("reformer-furnace", "Reformer furnace", FIRED, "furnace-reformer", 360, 240, 480, "box", "H", C.fired),
  eq("cracking-furnace", "Cracking furnace", FIRED, "furnace-cracking", 300, 180, 480, "box", "H", C.fired),
  eq("package-boiler", "Package boiler (water-tube)", FIRED, "boiler", 144, 72, 96, "box", "B", C.fired),
  eq("firetube-boiler", "Fire-tube boiler", FIRED, "boiler-firetube", 180, 84, 96, "hcyl", "B", C.fired),
  eq("waste-heat-boiler", "Waste-heat boiler (HRSG)", FIRED, "boiler-waste-heat", 360, 180, 480, "box", "WHB", C.fired),
  eq("thermal-oxidizer", "Thermal oxidizer / incinerator", FIRED, "thermal-oxidizer", 240, 96, 120, "hcyl", "TO", C.fired),
  eq("flare-stack", "Flare stack", FIRED, "flare", 36, 36, 1200, "vcyl", "FL", C.fired),
  eq("stack", "Stack / chimney", FIRED, "stack", 60, 60, 900, "vcyl", "STK", C.fired),

  // ---- heat exchangers (E) ----
  eq("shell-tube-exchanger", "Shell-and-tube exchanger", EXCHANGERS, "hx-shell-tube", 144, 30, 42, "hcyl", "E", C.hx),
  eq("kettle-reboiler", "Kettle reboiler", EXCHANGERS, "hx-kettle", 180, 60, 72, "hcyl", "E", C.hx),
  eq("double-pipe-exchanger", "Double-pipe (hairpin) exchanger", EXCHANGERS, "hx-double-pipe", 180, 24, 36, "box", "E", C.hx),
  eq("plate-exchanger", "Plate exchanger", EXCHANGERS, "hx-plate", 30, 48, 66, "box", "E", C.hx),
  eq("spiral-exchanger", "Spiral exchanger", EXCHANGERS, "hx-spiral", 48, 48, 60, "vcyl", "E", C.hx),
  eq("plate-fin-exchanger", "Plate-fin exchanger (cold box)", EXCHANGERS, "hx-plate-fin", 48, 48, 120, "box", "E", C.hx),
  eq("surface-condenser", "Surface condenser", EXCHANGERS, "hx-condenser", 240, 96, 120, "hcyl", "E", C.hx),
  eq("air-cooler", "Air-cooled exchanger", EXCHANGERS, "hx-air-cooled", 144, 96, 120, "box", "E", C.hx),
  eq("electric-process-heater", "Electric process heater", EXCHANGERS, "heater-electric", 96, 36, 36, "hcyl", "E", C.hx),

  // ---- columns & reactors (T, R) ----
  eq("column", "Column / tower (trayed)", COLUMNS, "column", 36, 36, 360, "vcyl", "T", C.column),
  eq("packed-column", "Packed column", COLUMNS, "column-packed", 48, 48, 480, "vcyl", "T", C.column),
  eq("absorber", "Absorber", COLUMNS, "column-absorber", 60, 60, 480, "vcyl", "T", C.column),
  eq("stripper", "Stripper", COLUMNS, "column-stripper", 42, 42, 360, "vcyl", "T", C.column),
  eq("vacuum-column", "Vacuum column", COLUMNS, "column-vacuum", 120, 120, 480, "vcyl", "T", C.column),
  eq("jacketed-reactor", "Jacketed reactor (stirred tank)", COLUMNS, "reactor", 60, 60, 96, "vcyl", "R", C.column),
  eq("fixed-bed-reactor", "Fixed-bed reactor", COLUMNS, "reactor-fixed-bed", 96, 96, 360, "vcyl", "R", C.column),
  eq("fluidized-bed-reactor", "Fluidized-bed reactor", COLUMNS, "reactor-fluidized", 144, 144, 480, "vcyl", "R", C.column),
  eq("catalyst-regenerator", "Catalyst regenerator", COLUMNS, "regenerator", 180, 180, 480, "vcyl", "R", C.column),
  eq("tubular-reactor", "Tubular reactor", COLUMNS, "reactor-tubular", 240, 48, 60, "box", "R", C.column),

  // ---- vessels & storage (V, TK) ----
  eq("vertical-vessel", "Vertical vessel", VESSELS, "vessel-vertical", 48, 48, 120, "vcyl", "V", C.vessel),
  eq("horizontal-drum", "Horizontal drum", VESSELS, "vessel-horizontal", 120, 42, 54, "hcyl", "V", C.vessel),
  eq("knockout-drum", "Knockout drum", VESSELS, "drum-knockout", 72, 72, 144, "vcyl", "V", C.vessel),
  eq("three-phase-separator", "Three-phase separator", VESSELS, "separator-three-phase", 240, 72, 96, "hcyl", "V", C.vessel),
  eq("reflux-accumulator", "Reflux accumulator", VESSELS, "accumulator", 144, 48, 72, "hcyl", "V", C.vessel),
  eq("storage-tank", "Storage tank (cone roof)", VESSELS, "tank-cone-roof", 144, 144, 144, "vcyl", "TK", C.vessel),
  eq("dome-roof-tank", "Storage tank (dome roof)", VESSELS, "tank-dome-roof", 240, 240, 360, "vcyl", "TK", C.vessel),
  eq("floating-roof-tank", "Storage tank (floating roof)", VESSELS, "tank-floating-roof", 360, 360, 480, "vcyl", "TK", C.vessel),
  eq("pressure-sphere", "Pressure storage sphere", VESSELS, "sphere", 360, 360, 420, "sphere", "TK", C.vessel),
  eq("lpg-bullet", "Pressurized bullet (LPG)", VESSELS, "bullet", 480, 120, 156, "hcyl", "TK", C.vessel),
  eq("day-tank", "Day tank", VESSELS, "tank-day", 60, 60, 72, "vcyl", "TK", C.vessel),

  // ---- separation & filtration (F, S, ...) ----
  eq("cartridge-filter", "Cartridge filter", SEPARATION, "filter", 24, 24, 60, "vcyl", "F", C.sep),
  eq("basket-strainer", "Basket strainer", SEPARATION, "strainer", 24, 18, 24, "box", "F", C.sep),
  eq("cyclone", "Cyclone separator", SEPARATION, "cyclone", 36, 36, 120, "vcyl", "S", C.sep),
  eq("centrifuge", "Centrifuge", SEPARATION, "centrifuge", 60, 48, 60, "box", "S", C.sep),
  eq("coalescer", "Coalescer", SEPARATION, "coalescer", 120, 36, 48, "hcyl", "S", C.sep),
  eq("desalter", "Desalter", SEPARATION, "desalter", 360, 144, 180, "hcyl", "S", C.sep),
  eq("desiccant-dryer", "Desiccant dryer (twin tower)", SEPARATION, "dryer-desiccant", 72, 36, 120, "box", "DR", C.sep),
  eq("evaporator", "Evaporator", SEPARATION, "evaporator", 72, 72, 240, "vcyl", "EV", C.sep),
  eq("crystallizer", "Crystallizer", SEPARATION, "crystallizer", 96, 96, 180, "vcyl", "CZ", C.sep),
  eq("filter-press", "Filter press", SEPARATION, "filter-press", 180, 60, 72, "box", "F", C.sep),
  eq("baghouse", "Baghouse (fabric filter)", SEPARATION, "baghouse", 144, 96, 240, "box", "F", C.sep),
  eq("electrostatic-precipitator", "Electrostatic precipitator", SEPARATION, "precipitator", 240, 144, 300, "box", "ESP", C.sep),
  eq("wet-scrubber", "Wet scrubber", SEPARATION, "scrubber", 60, 60, 240, "vcyl", "SC", C.sep),

  // ---- solids handling ----
  eq("belt-conveyor", "Belt conveyor", SOLIDS, "conveyor", 240, 36, 36, "box", "CV", C.solids),
  eq("screw-conveyor", "Screw conveyor", SOLIDS, "conveyor-screw", 240, 18, 24, "hcyl", "CV", C.solids),
  eq("bucket-elevator", "Bucket elevator", SOLIDS, "elevator-bucket", 36, 24, 480, "box", "CV", C.solids),
  eq("rotary-valve", "Rotary valve (airlock)", SOLIDS, "rotary-valve", 18, 18, 24, "box", "RV", C.solids),
  eq("crusher", "Crusher", SOLIDS, "crusher", 72, 60, 72, "box", "CR", C.solids),
  eq("ball-mill", "Ball mill", SOLIDS, "mill", 240, 96, 120, "hcyl", "ML", C.solids),
  eq("weigh-feeder", "Weigh feeder", SOLIDS, "weigh-feeder", 60, 36, 48, "box", "WF", C.solids),
  eq("hopper", "Hopper / silo", SOLIDS, "hopper", 96, 96, 240, "vcyl", "HP", C.solids),

  // ---- mixing (AG, MX) ----
  eq("agitated-tank", "Mixing tank with agitator", MIXING, "agitator-tank", 72, 72, 96, "vcyl", "AG", C.mix),
  eq("static-mixer", "Static mixer", MIXING, "static-mixer", 36, 12, 12, "hcyl", "MX", C.mix),
  eq("inline-dynamic-mixer", "In-line dynamic mixer", MIXING, "mixer-inline", 36, 24, 24, "box", "MX", C.mix),
  eq("ribbon-blender", "Ribbon blender", MIXING, "blender-ribbon", 120, 48, 60, "box", "MX", C.mix),

  // ---- utilities & environmental ----
  eq("cooling-tower", "Cooling tower", UTILITIES, "cooling-tower", 144, 144, 180, "box", "CT", C.util),
  eq("chiller-package", "Chiller package", UTILITIES, "chiller", 120, 60, 72, "box", "CH", C.util),
  eq("deaerator", "Deaerator", UTILITIES, "deaerator", 144, 60, 96, "hcyl", "DA", C.util),
  eq("water-treatment-skid", "Water treatment skid", UTILITIES, "water-treatment", 120, 60, 96, "box", "WT", C.util),
  eq("api-separator", "API oil-water separator", UTILITIES, "api-separator", 480, 120, 72, "box", "S", C.util),

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
]);

registerSymbolSet({
  domain: PROCESS_EQUIPMENT_DOMAIN,
  title: "Process equipment",
  symbols: PROCESS_EQUIPMENT.map((s) => ({ ...s })),
});
