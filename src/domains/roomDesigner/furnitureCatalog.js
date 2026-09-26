// Starter furniture catalog for the FORGE room/layout designer.
//
// This file is the catalog's registration site in the domain-extensible
// symbol registry (see symbolRegistry.js): the "furniture" and "rooms"
// symbol sets are registered here, each declaring its symbols, default
// sizes, and 2D draw routines (routines live in
// src/components/designer/symbolDrawRoutines.jsx and are resolved per
// domain). The historical accessors below (getCatalogEntry,
// catalogByCategory, ...) are kept working and now read from the registry,
// so existing canvas / reducer / persistence / 3D code is untouched.
//
// Dimensions are nominal US-standard sizes in inches (width x depth x height)
// used for 2D symbols and simple 3D volumes. They are starting points for
// layout planning, not manufacturer specs — real pieces vary.

import { findSymbol, getSymbolSet, registerSymbolSet } from "./symbolRegistry";

export const FURNITURE_CATEGORIES = Object.freeze([
  "seating",
  "tables",
  "bedroom",
  "kitchen",
  "cabinets",
  "bath",
  "laundry",
  "storage",
  "lighting",
]);

const entry = (id, label, category, widthIn, depthIn, heightIn, color, symbol = "rect") =>
  Object.freeze({ id, label, category, widthIn, depthIn, heightIn, color, symbol });

// Cabinets carry a sizeFamily (see furnitureSizing.js: the standard widths,
// depths and heights offered for that family) and, when wall-mounted, mountIn:
// the default height of the cabinet's BOTTOM above the floor (54" = 36"
// counter + 18" backsplash, the usual upper-cabinet line).
const cab = (id, label, widthIn, depthIn, heightIn, sizeFamily, { mountIn, color = "#a8a29e" } = {}) =>
  Object.freeze({
    id, label, category: "cabinets", widthIn, depthIn, heightIn, color, symbol: "rect", sizeFamily,
    ...(mountIn !== undefined ? { mountIn } : {}),
  });

export const FURNITURE_CATALOG = Object.freeze([
  // seating
  entry("sofa-3seat", "Sofa (3-seat)", "seating", 84, 36, 34, "#7aa2c4"),
  entry("loveseat", "Loveseat", "seating", 60, 36, 34, "#8fb4d4"),
  entry("armchair", "Armchair", "seating", 36, 36, 34, "#9cc0da"),
  entry("recliner", "Recliner", "seating", 38, 40, 40, "#86a9cc"),
  entry("office-chair", "Office chair", "seating", 26, 26, 42, "#6b7280", "circle"),
  entry("dining-chair", "Dining chair", "seating", 18, 18, 36, "#a3835b"),
  // tables
  entry("coffee-table", "Coffee table", "tables", 48, 24, 18, "#8a6f4d"),
  entry("side-table", "Side table", "tables", 22, 22, 24, "#93795a", "circle"),
  entry("dining-table-rect", "Dining table", "tables", 72, 36, 30, "#7d6248"),
  entry("dining-table-round", "Round dining table", "tables", 48, 48, 30, "#7d6248", "circle"),
  entry("desk", "Desk", "tables", 48, 24, 30, "#9a7c55"),
  entry("kitchen-island", "Kitchen island", "tables", 72, 36, 36, "#b0b7bf"),
  // bedroom
  entry("bed-twin", "Twin bed", "bedroom", 38, 75, 28, "#a8c3e0"),
  entry("bed-full", "Full bed", "bedroom", 54, 75, 28, "#a8c3e0"),
  entry("bed-queen", "Queen bed", "bedroom", 60, 80, 28, "#9db8d8"),
  entry("bed-king", "King bed", "bedroom", 76, 80, 28, "#93aed2"),
  entry("nightstand", "Nightstand", "bedroom", 24, 24, 26, "#8a6f4d"),
  entry("dresser", "Dresser", "bedroom", 60, 20, 34, "#93795a"),
  // kitchen
  entry("refrigerator", "Refrigerator", "kitchen", 36, 30, 70, "#c9ced6"),
  entry("range", "Range", "kitchen", 30, 28, 36, "#9aa0a8"),
  entry("dishwasher", "Dishwasher", "kitchen", 24, 24, 34, "#b5bac2"),
  entry("microwave-cart", "Microwave cart", "kitchen", 30, 18, 34, "#a8adb5"),
  entry("sink-kitchen-33", "Kitchen sink (drop-in)", "kitchen", 33, 22, 10, "#dfe5ec"),
  // cabinets — nominal US-standard sizes; every one resizable to the
  // standard sizes of its family or any custom size (furnitureSizing.js).
  // base (floor-standing, height includes the countertop)
  cab("cabinet-base-24", "Base cabinet", 24, 24, 34, "base"),
  cab("cabinet-base-db", "Drawer base unit", 18, 24, 34, "base"),
  cab("cabinet-base-drawer", "Drawer base (3-drawer)", 24, 24, 34, "base"),
  cab("cabinet-sink-36", "Sink base cabinet", 36, 24, 34, "sink-base"),
  cab("cabinet-sink-farm", "Farm sink base", 36, 24, 34, "sink-base"),
  cab("cabinet-base-trash", "Trash pull-out base", 18, 24, 34, "base"),
  cab("cabinet-base-corner", "Corner base (lazy Susan)", 36, 36, 34, "corner-base"),
  cab("cabinet-base-blind", "Blind corner base (left)", 36, 24, 34, "blind-base"),
  cab("cabinet-base-blind-rh", "Blind corner base (right)", 36, 24, 34, "blind-base"),
  cab("cabinet-base-easy-reach", "Easy reach corner base", 36, 36, 34, "corner-base"),
  cab("cabinet-island-base", "Island base cabinet", 36, 24, 34, "base"),
  // wall (mounted)
  cab("cabinet-wall-24", "Wall cabinet", 24, 12, 36, "wall", { mountIn: 54, color: "#b8b2ab" }),
  cab("cabinet-wall-corner", "Wall corner cabinet", 24, 24, 30, "wall-corner", { mountIn: 54, color: "#b8b2ab" }),
  cab("cabinet-wall-bridge", "Bridge / over-fridge cabinet", 36, 24, 15, "bridge", { mountIn: 72, color: "#b8b2ab" }),
  cab("cabinet-wall-microwave", "Microwave wall cabinet", 30, 12, 18, "wall", { mountIn: 66, color: "#b8b2ab" }),
  cab("cabinet-open-shelf", "Open shelf", 30, 12, 12, "wall", { mountIn: 54, color: "#c7b8a3" }),
  // tall
  cab("cabinet-pantry-24", "Tall pantry", 24, 24, 84, "tall"),
  cab("cabinet-tall-oven", "Oven cabinet", 30, 24, 84, "tall"),
  cab("cabinet-tall-utility", "Utility / broom cabinet", 18, 24, 84, "tall"),
  // vanity & bath
  cab("cabinet-vanity-sink", "Vanity sink base", 30, 21, 34, "vanity"),
  cab("cabinet-vanity-drawer", "Vanity drawer base", 12, 21, 34, "vanity"),
  cab("cabinet-linen-tower", "Linen tower", 18, 21, 84, "linen"),
  cab("cabinet-bath-wall", "Bathroom wall cabinet", 24, 8, 30, "bath-wall", { mountIn: 48, color: "#b8b2ab" }),
  // bath
  entry("toilet", "Toilet", "bath", 28, 24, 28, "#e8ecf1"),
  entry("vanity-single", "Vanity (single)", "bath", 36, 21, 34, "#b9c2cc"),
  entry("vanity-double", "Vanity (double)", "bath", 60, 21, 34, "#b9c2cc"),
  entry("bathtub", "Bathtub", "bath", 60, 32, 22, "#eef1f5"),
  entry("shower", "Shower stall", "bath", 36, 36, 78, "#dfe5ec"),
  entry("shower-48x36", "Shower stall 48\"", "bath", 48, 36, 78, "#dfe5ec"),
  entry("sink-pedestal", "Pedestal sink", "bath", 22, 20, 34, "#e8ecf1"),
  entry("sink-bath-round", "Bath sink (round)", "bath", 19, 19, 8, "#e8ecf1", "circle"),
  // laundry
  entry("washer", "Washer", "laundry", 27, 27, 40, "#c2c7cf"),
  entry("dryer", "Dryer", "laundry", 27, 27, 40, "#c2c7cf"),
  entry("water-heater", "Water heater", "laundry", 24, 24, 60, "#c9ced6", "circle"),
  entry("utility-sink", "Utility sink", "laundry", 24, 20, 36, "#d4d9e0"),
  // storage
  entry("bookshelf", "Bookshelf", "storage", 36, 12, 72, "#7d6248"),
  entry("tv-stand", "TV stand", "storage", 60, 18, 24, "#6f5940"),
  entry("wardrobe", "Wardrobe", "storage", 48, 24, 72, "#8a6f4d"),
  entry("storage-chest", "Storage chest", "storage", 48, 20, 20, "#9a7c55"),
  // lighting
  entry("floor-lamp", "Floor lamp", "lighting", 18, 18, 62, "#e3c878", "circle"),
  entry("table-lamp", "Table lamp", "lighting", 12, 12, 24, "#e3c878", "circle"),
]);

/** Look up a catalog entry by id; undefined when unknown. */
export function getCatalogEntry(id) {
  return findSymbol("furniture", id);
}

/** Full catalog list. */
export function listCatalog() {
  return getSymbolSet("furniture")?.symbols || FURNITURE_CATALOG;
}

/** Catalog entries grouped by category, in FURNITURE_CATEGORIES order. */
export function catalogByCategory() {
  const symbols = getSymbolSet("furniture")?.symbols || FURNITURE_CATALOG;
  return FURNITURE_CATEGORIES.map((category) => ({
    category,
    items: symbols.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);
}

/** True when every entry has sane positive dimensions and a known category. */
export function validateCatalog() {
  const errors = [];
  const seen = new Set();
  for (const item of listCatalog()) {
    if (seen.has(item.id)) errors.push(`duplicate catalog id: ${item.id}`);
    seen.add(item.id);
    if (!FURNITURE_CATEGORIES.includes(item.category)) {
      errors.push(`unknown category for ${item.id}: ${item.category}`);
    }
    for (const dim of ["widthIn", "depthIn", "heightIn"]) {
      if (!(typeof item[dim] === "number" && item[dim] > 0)) {
        errors.push(`bad ${dim} for ${item.id}`);
      }
    }
  }
  return errors;
}

// ---- Pre-shaped rooms (width x depth in inches) — the "drop a room"
// templates that mirror Homestyler's room-shape starter set. Moved here
// from designerDocument so the catalog owns every symbol set.
export const ROOM_TEMPLATES = Object.freeze([
  Object.freeze({ id: "living-room", label: "Living room", widthIn: 192, depthIn: 240 }),
  Object.freeze({ id: "bedroom", label: "Bedroom", widthIn: 144, depthIn: 144 }),
  Object.freeze({ id: "bedroom-small", label: "Bedroom (small)", widthIn: 120, depthIn: 144 }),
  Object.freeze({ id: "bedroom-12x14", label: "Bedroom 12×14", widthIn: 144, depthIn: 168 }),
  Object.freeze({ id: "kitchen", label: "Kitchen", widthIn: 120, depthIn: 144 }),
  Object.freeze({ id: "kitchen-12x14", label: "Kitchen 12×14", widthIn: 144, depthIn: 168 }),
  Object.freeze({ id: "dining-room", label: "Dining room", widthIn: 144, depthIn: 168 }),
  Object.freeze({ id: "master-bedroom", label: "Master bedroom", widthIn: 168, depthIn: 216 }),
  Object.freeze({ id: "bathroom", label: "Bathroom", widthIn: 96, depthIn: 72 }),
  Object.freeze({ id: "bathroom-small", label: "Bathroom (small)", widthIn: 60, depthIn: 96 }),
  Object.freeze({ id: "garage", label: "Garage", widthIn: 240, depthIn: 240 }),
  Object.freeze({ id: "office", label: "Office", widthIn: 120, depthIn: 120 }),
]);

// ---- Drop-in structures (width x depth in inches) — large labeled
// rectangular footprints placed through the same drop pipeline as rooms
// (four walls + labeled polygon). Standard intermodal container sizes;
// heights are nominal (8'6" standard) and informational only.
export const STRUCTURE_TEMPLATES = Object.freeze([
  Object.freeze({ id: "container-20", label: "Shipping container 20'", widthIn: 240, depthIn: 96 }),
  Object.freeze({ id: "container-40", label: "Shipping container 40'", widthIn: 480, depthIn: 96 }),
]);

// ---- Symbol-set registration ----
// The canvas renders registered symbols through their domain's 2D draw
// routine and the palettes list registered sets, so adding a domain is
// registration-only: no changes to PlanCanvas.jsx, designerReducer.js,
// or designerDocument.js.

registerSymbolSet({
  domain: "furniture",
  title: "Furniture",
  symbols: FURNITURE_CATALOG.map((item) => ({ ...item })),
});

registerSymbolSet({
  domain: "rooms",
  title: "Rooms",
  symbols: ROOM_TEMPLATES.map((t) => ({ ...t })),
});

// ---- Adding a new symbol domain (Phase 2 example: Piping) ----
//
// A future "Piping" domain (pipes, valves, fittings, pumps, tanks, flow
// arrows) is added by registering a set — nothing else:
//
//   import { registerSymbolSet } from "./symbolRegistry";
//   import { registerDrawRoutine } from "@/components/designer/symbolDrawRoutines";
//
//   registerSymbolSet({
//     domain: "piping",
//     title: "Piping",
//     symbols: [
//       { id: "gate-valve", label: "Gate valve", widthIn: 12, depthIn: 12, color: "#c0c7d1" },
//       { id: "pump", label: "Pump", widthIn: 24, depthIn: 18, color: "#9fb3c8" },
//       // pipes, fittings, tanks, flow arrows...
//     ],
//   });
//
//   // Custom 2D look for the domain (optional — without this, symbols draw
//   // with the default rect/circle + label routine):
//   registerDrawRoutine("piping", drawPipingSymbol);
//
// The 2D canvas picks the routine up by domain, the tool palette can list
// the set via listSymbolSets()/getSymbolSet("piping"), and persistence
// keeps storing plain design JSON. The Phase 2 slice then only adds the
// piping tool UI and its instance handling — the catalog needs no rework.
