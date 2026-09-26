// Core FORGE command-palette actions. Every href below was verified against a
// real route in this repo (page.js/page.jsx present, or an intentional redirect):
//   /forge/rental?section=<id>  -> Rental Manager section (sections come from
//                                RENTAL_FUNCTIONS in RentalApplicationShell.jsx)
//   /forge/property             -> redirects to /forge/rental?section=properties
//   /forge/financial            -> Financial dashboard (Cash Forecast panel lives here)
//   /forge/budget, /forge/scheduling, /forge/call-shield, /forge/private-financing,
//   /forge/reservations, /forge/designer, /forge/inbox, /forge/capture,
//   /forge/health, /forge/import, /forge/workspace, /forge/charts,
//   /forge/connections, /forge/results, /forge/developer
//
// Other slices extend the palette by calling registerCommandPaletteAction()
// from their own modules -- see registry.js. Registration dedupes by id, so
// importing this module more than once is safe.

import { registerCommandPaletteAction } from "./registry";

const ACTION_GROUP = "Actions";
const NAV_GROUP = "Go to";

export const FORGE_COMMAND_SEEDS = Object.freeze([
  // --- Actions (things to do) ---
  Object.freeze({
    id: "record-rent-payment",
    title: "Record rent payment",
    keywords: ["rent", "payment", "post income", "offline payment", "charge"],
    hint: "Rentals · Rent & Payments",
    group: ACTION_GROUP,
    href: "/forge/rental?section=charges",
  }),
  Object.freeze({
    id: "add-expense",
    title: "Add expense",
    keywords: ["expense", "cost", "manual entry", "spend"],
    hint: "Rentals · Reports",
    group: ACTION_GROUP,
    href: "/forge/rental?section=reports",
  }),
  Object.freeze({
    id: "run-rent-roll",
    title: "Run rent roll report",
    keywords: ["rent roll", "report", "occupancy", "units"],
    hint: "Rentals · Reports",
    group: ACTION_GROUP,
    href: "/forge/rental?section=reports",
  }),
  Object.freeze({
    id: "open-tenant-ledger",
    title: "Open tenant ledger",
    keywords: ["tenant", "ledger", "balance", "payment history"],
    hint: "Rentals · Tenants",
    group: ACTION_GROUP,
    href: "/forge/rental?section=tenants",
  }),
  Object.freeze({
    id: "add-property",
    title: "Add property",
    keywords: ["property", "unit", "new", "create"],
    hint: "Rentals · Properties",
    group: ACTION_GROUP,
    href: "/forge/rental?section=setup",
  }),
  Object.freeze({
    id: "open-cash-forecast",
    title: "Open cash forecast",
    keywords: ["cash", "forecast", "projection", "runway"],
    hint: "Financial",
    group: ACTION_GROUP,
    href: "/forge/financial",
  }),
  // --- Navigation (places to go) ---
  Object.freeze({
    id: "go-rentals",
    title: "Go to Rentals",
    keywords: ["rentals", "rental manager", "leases", "tenants"],
    hint: "/forge/rental",
    group: NAV_GROUP,
    href: "/forge/rental",
  }),
  Object.freeze({
    id: "go-financial",
    title: "Go to Financial",
    keywords: ["financial", "books", "accounting", "dashboard"],
    hint: "/forge/financial",
    group: NAV_GROUP,
    href: "/forge/financial",
  }),
  Object.freeze({
    id: "go-budget",
    title: "Go to Budget",
    keywords: ["budget", "spending plan"],
    hint: "/forge/budget",
    group: NAV_GROUP,
    href: "/forge/budget",
  }),
  Object.freeze({
    id: "go-scheduling",
    title: "Go to Scheduling",
    keywords: ["scheduling", "gantt", "project", "calendar"],
    hint: "/forge/scheduling",
    group: NAV_GROUP,
    href: "/forge/scheduling",
  }),
  Object.freeze({
    id: "go-call-shield",
    title: "Go to Call Shield",
    keywords: ["call shield", "calls", "spam", "evidence"],
    hint: "/forge/call-shield",
    group: NAV_GROUP,
    href: "/forge/call-shield",
  }),
  Object.freeze({
    id: "go-private-financing",
    title: "Go to Private Financing",
    keywords: ["private financing", "lending", "borrower", "loans"],
    hint: "/forge/private-financing",
    group: NAV_GROUP,
    href: "/forge/private-financing",
  }),
  Object.freeze({
    id: "go-reservations",
    title: "Go to Reservations",
    keywords: ["reservations", "rv", "cabin", "booking"],
    hint: "/forge/reservations",
    group: NAV_GROUP,
    href: "/forge/reservations",
  }),
  Object.freeze({
    id: "go-designer",
    title: "Go to Designer",
    keywords: ["designer", "floor plan", "3d", "room"],
    hint: "/forge/designer",
    group: NAV_GROUP,
    href: "/forge/designer",
  }),
  Object.freeze({
    id: "go-inbox",
    title: "Go to Inbox",
    keywords: ["inbox", "messages"],
    hint: "/forge/inbox",
    group: NAV_GROUP,
    href: "/forge/inbox",
  }),
  Object.freeze({
    id: "go-capture",
    title: "Go to Capture",
    keywords: ["capture", "screenshot", "screen capture"],
    hint: "/forge/capture",
    group: NAV_GROUP,
    href: "/forge/capture",
  }),
  Object.freeze({
    id: "go-health",
    title: "Go to Health",
    keywords: ["health", "status"],
    hint: "/forge/health",
    group: NAV_GROUP,
    href: "/forge/health",
  }),
  Object.freeze({
    id: "go-import",
    title: "Go to Import",
    keywords: ["import", "upload", "csv"],
    hint: "/forge/import",
    group: NAV_GROUP,
    href: "/forge/import",
  }),
  Object.freeze({
    id: "go-members",
    title: "Go to Members",
    keywords: ["members", "team", "users", "workspace"],
    hint: "/forge/workspace",
    group: NAV_GROUP,
    href: "/forge/workspace",
  }),
  Object.freeze({
    id: "go-charts",
    title: "Go to Charts",
    keywords: ["charts", "graphs"],
    hint: "/forge/charts",
    group: NAV_GROUP,
    href: "/forge/charts",
  }),
  Object.freeze({
    id: "go-connections",
    title: "Go to Connections",
    keywords: ["connections", "bank", "integrations", "plaid", "stripe"],
    hint: "/forge/connections",
    group: NAV_GROUP,
    href: "/forge/connections",
  }),
  Object.freeze({
    id: "go-results",
    title: "Go to Results",
    keywords: ["results"],
    hint: "/forge/results",
    group: NAV_GROUP,
    href: "/forge/results",
  }),
  Object.freeze({
    id: "go-developer",
    title: "Go to Developer",
    keywords: ["developer", "programmer", "tools", "engineering"],
    hint: "/forge/developer",
    group: NAV_GROUP,
    href: "/forge/developer",
  }),
]);

export function seedForgeCommandPalette() {
  for (const seed of FORGE_COMMAND_SEEDS) registerCommandPaletteAction(seed);
}

// Auto-seed on import: the palette host imports this module, so the core
// actions are always registered before first render. Idempotent by id.
seedForgeCommandPalette();
