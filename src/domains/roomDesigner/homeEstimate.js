// Construction estimating for FORGE Home Designer (slice 4).
//
// Pure: geometry -> quantities (slice 3) -> assemblies -> estimates ->
// proposal. Nothing here invents prices: every dollar in an estimate traces
// to a unit cost the user typed, or the line item is explicitly "pending".
// Pending by absence — only assemblies the user actually priced appear in
// the persisted envelope.
//
// Money is INTEGER CENTS everywhere inside the envelope
// (project.estimate.unitCostsCents). quantity x unitCostCents = extendedCents
// keeps the entire financial chain integer-safe; the UI converts cents <->
// $ display at its boundary. The module never throws at the estimate
// boundary: estimateProject returns { ok: false, error } on corrupt input
// so the screen can surface a status message instead of crashing.
//
// Quantity provenance: every line item carries where its quantity came from
// ({ quantitySource: "designer_geometry", measurementVersion }) so the
// proposal document can show the trace.

import {
  measureHomeProject,
  normalizeUnits,
  projectWithEditedDesign,
} from "./homeQuantities";

export const ESTIMATE_VERSION = 1;
export const MEASUREMENT_VERSION = 1;

/** Where every estimate quantity comes from — always plan geometry. */
export const QUANTITY_SOURCE = "designer_geometry";

/**
 * Frozen assembly catalog. Each entry maps to a key of the
 * measureHomeProject() totals object (verified by test); `unit` selects
 * how the raw total converts to a billable quantity:
 *   sqft  — totals value is already square feet
 *   linft — totals value is inches; quantity is linear feet
 *   each  — totals value is a count
 */
export const ASSEMBLIES = Object.freeze([
  { id: "flooring", name: "Flooring", quantityKey: "netRoomAreaSqFt", unit: "sqft" },
  { id: "wall_paint", name: "Interior paint — walls (one face)", quantityKey: "wallSurfaceAreaSqFt", unit: "sqft" },
  { id: "drywall", name: "Drywall hang & finish", quantityKey: "wallSurfaceAreaSqFt", unit: "sqft" },
  { id: "baseboard", name: "Baseboard trim", quantityKey: "netWallLengthIn", unit: "linft" },
  { id: "interior_door", name: "Interior doors", quantityKey: "doorCount", unit: "each" },
  { id: "windows", name: "Windows", quantityKey: "windowCount", unit: "each" },
  { id: "plumbing_rough", name: "Rough plumbing", quantityKey: "totalPipeLengthIn", unit: "linft" },
]);

export const ASSEMBLY_IDS = Object.freeze(ASSEMBLIES.map((a) => a.id));

const ASSEMBLY_BY_ID = new Map(ASSEMBLIES.map((a) => [a.id, a]));

function nowIso() {
  return new Date().toISOString();
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Fail-closed normalization of a stored estimate envelope. Unknown assembly
 * ids are dropped, non-finite/negative costs are dropped, fractional cents
 * are rounded to whole cents. Missing input (legacy rows) normalizes to an
 * empty envelope — pending by absence.
 */
export function normalizeEstimate(raw) {
  const unitCostsCents = {};
  const input =
    raw && typeof raw === "object" && raw.unitCostsCents && typeof raw.unitCostsCents === "object"
      ? raw.unitCostsCents
      : undefined;
  if (input) {
    for (const id of ASSEMBLY_IDS) {
      const v = input[id];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        unitCostsCents[id] = Math.round(v);
      }
    }
  }
  return {
    version: ESTIMATE_VERSION,
    unitCostsCents,
    updatedAt:
      raw && typeof raw === "object" && typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : null,
  };
}

/** The project's estimate envelope, always normalized (never throws). */
export function getEstimate(project) {
  return normalizeEstimate(project ? project.estimate : undefined);
}

/**
 * Set (or clear) a unit cost. Pure project-metadata op — intentionally NOT
 * undoable, same documented rule as slice-2 level management; the screen
 * applies it via syncProject + TOUCH so it persists through the save flow.
 *
 * centsOrNull: integer cents, or null to clear the cost back to pending.
 * Throws on an unknown assembly id or an invalid cost; the UI converts the
 * throw into a status message, never a crash.
 */
export function setUnitCost(project, assemblyId, centsOrNull) {
  if (!ASSEMBLY_BY_ID.has(assemblyId)) {
    throw new Error(`Unknown assembly ${assemblyId}.`);
  }
  const unitCostsCents = { ...getEstimate(project).unitCostsCents };
  if (centsOrNull === null || centsOrNull === undefined) {
    delete unitCostsCents[assemblyId];
  } else {
    if (
      typeof centsOrNull !== "number" ||
      !Number.isFinite(centsOrNull) ||
      centsOrNull < 0
    ) {
      throw new Error("Unit cost must be a non-negative number of cents.");
    }
    unitCostsCents[assemblyId] = Math.round(centsOrNull);
  }
  return {
    ...project,
    estimate: {
      version: ESTIMATE_VERSION,
      unitCostsCents,
      updatedAt: nowIso(),
    },
  };
}

/**
 * Parse a unit-cost text input (dollars) at the UI boundary.
 * Returns { cents } on success, { clear: true } for an empty input
 * (back to pending), or { invalid: true } — the caller shows a status
 * message and does not commit.
 */
export function parseUnitCostInput(text) {
  const t = typeof text === "string" ? text.trim().replace(/[$,]/g, "") : "";
  if (t === "") return { clear: true };
  const dollars = Number(t);
  if (!Number.isFinite(dollars) || dollars < 0) return { invalid: true };
  return { cents: Math.round(dollars * 100) };
}

/** Integer cents -> "$1,234.56". */
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
export function formatUSD(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "$0.00";
  return usdFormatter.format(Math.round(value) / 100);
}

/** Unit label for an assembly row ("$/sq ft", "$/lin ft", "$/each"). */
export function unitCostLabel(unit) {
  switch (unit) {
    case "sqft":
      return "$/sq ft";
    case "linft":
      return "$/lin ft";
    default:
      return "$/each";
  }
}

function resolveQuantity(assembly, totals) {
  const raw = Number(totals[assembly.quantityKey]);
  const value = Number.isFinite(raw) ? raw : 0;
  switch (assembly.unit) {
    case "linft":
      return round2(Math.max(0, value / 12));
    case "each":
      return Math.max(0, Math.round(value));
    default:
      return round2(Math.max(0, value));
  }
}

/**
 * Full estimate for a HomeProject. Measures the edited (possibly unsaved)
 * design swapped into the current level — the estimate always reflects what
 * is on screen, like Measurements does. Never throws: corrupt input returns
 * { ok: false, error }.
 *
 * Line items carry quantity provenance ({ quantitySource,
 * measurementVersion, generatedAt }) so the proposal document shows the
 * trace from each number back to the plan geometry it came from.
 */
export function estimateProject(project, editedDesign) {
  try {
    // The edited (possibly unsaved) design is swapped into the current level
    // when the screen passes one; otherwise the stored project measures
    // as-is. projectWithEditedDesign returns null without a design, so the
    // fallback keeps the editedDesign argument genuinely optional.
    const withDesign = editedDesign
      ? projectWithEditedDesign(project, editedDesign)
      : project;
    const measured = measureHomeProject(withDesign);
    if (!measured.ok) return { ok: false, error: measured.error };
    const totals = measured.totals;
    const { unitCostsCents } = getEstimate(project);
    const generatedAt = nowIso();
    const items = ASSEMBLIES.map((assembly) => {
      const quantity = resolveQuantity(assembly, totals);
      const unitCostCents = Object.hasOwn(unitCostsCents, assembly.id)
        ? unitCostsCents[assembly.id]
        : null;
      // Single rounding at the end of the line: integer-cent money math.
      const extendedCents =
        unitCostCents === null ? null : Math.round(quantity * unitCostCents);
      return {
        assemblyId: assembly.id,
        name: assembly.name,
        quantity,
        unit: assembly.unit,
        unitCostCents,
        extendedCents,
        status: unitCostCents === null ? "pending" : "priced",
        quantitySource: QUANTITY_SOURCE,
        measurementVersion: MEASUREMENT_VERSION,
        generatedAt,
      };
    });
    const priced = items.filter((item) => item.status === "priced");
    const pending = items.filter((item) => item.status === "pending");
    return {
      ok: true,
      projectName: measured.projectName,
      building:
        project && project.building && typeof project.building === "object"
          ? project.building
          : null,
      units: normalizeUnits(measured.units),
      levelCount: measured.levelCount,
      measurementVersion: MEASUREMENT_VERSION,
      generatedAt,
      items,
      subtotalCents: priced.reduce((sum, item) => sum + item.extendedCents, 0),
      pricedCount: priced.length,
      pendingCount: pending.length,
      pendingItems: pending.map((item) => item.name),
      assumptions: totals.assumptions || [],
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error && error.message ? error.message : "Could not estimate the project.",
    };
  }
}
