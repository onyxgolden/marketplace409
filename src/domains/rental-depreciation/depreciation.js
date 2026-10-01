// Rentec parity R19: depreciation schedule domain (pure — no DB, no fetch).
//
// Per-property depreciation assets with a straight-line monthly schedule
// engine. ALL money is integer cents. The engine uses largest-remainder
// rounding: every monthly amount is whole cents and the schedule sums
// EXACTLY to the depreciable basis.
//
// Depreciable basis = cost - salvage for straight line. The MACRS
// real-property presets ignore salvage value entirely (IRS tax depreciation
// does not reduce depreciable basis by salvage): for those methods the
// basis is the full cost, no matter what salvage is stored.
//
// BOOKS INTEGRATION DECISION (see DEPRECIATION_METHODS.md for the full
// rationale): depreciation is REPORT-ONLY. It never posts to the property
// ledger, never touches the bank register, and never moves cash. The ledger
// stays cash-based; the depreciation report hands the CPA the numbers and
// the CPA decides whether/where to book them.

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

export const ASSET_CATEGORIES = [
  { code: "building", label: "Building" },
  { code: "improvement", label: "Improvement" },
  { code: "appliance", label: "Appliance" },
  { code: "equipment", label: "Equipment" },
  { code: "other", label: "Other" },
];

// MACRS real-property presets are straight-line with the IRS mid-month
// convention: a half month of depreciation in the placed-in-service month,
// with the other half recovered in the extra final month (month N+1). These
// are book/tax-planning approximations — the full IRS MACRS tables
// (half-year conventions, Section 179, bonus depreciation) are explicitly
// out of scope. See DEPRECIATION_METHODS.md.
export const DEPRECIATION_METHODS = {
  straight_line: {
    code: "straight_line",
    label: "Straight line",
    description: "Even monthly depreciation over a custom useful life.",
    midMonthConvention: false,
    presetLifeMonths: null,
  },
  macrs_27_5: {
    code: "macrs_27_5",
    label: "MACRS 27.5-year residential rental",
    description: "Straight-line over 27.5 years (330 months) with the IRS mid-month convention. For residential rental property.",
    midMonthConvention: true,
    presetLifeMonths: 330,
  },
  macrs_39: {
    code: "macrs_39",
    label: "MACRS 39-year nonresidential real property",
    description: "Straight-line over 39 years (468 months) with the IRS mid-month convention. For nonresidential real property.",
    midMonthConvention: true,
    presetLifeMonths: 468,
  },
};

export const MACRS_LIFE_MONTHS = { macrs_27_5: 330, macrs_39: 468 };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toPositiveIntCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

// validateDepreciationAsset(input) → { ok, clean, error }.
// clean carries: description, category, placedInService (YYYY-MM-DD),
// costBasisCents, method, usefulLifeMonths (MACRS inputs are normalized to
// the preset), salvageValueCents, notes.
export function validateDepreciationAsset(input = {}) {
  const description = String(input.description ?? "").trim();
  if (!description) return { ok: false, error: "Give the asset a description (e.g. \"Roof replacement\", \"Refrigerator\")." };

  const category = String(input.category ?? "other").trim();
  if (!ASSET_CATEGORIES.some((c) => c.code === category)) {
    return { ok: false, error: "Category must be one of: building, improvement, appliance, equipment, other." };
  }

  const placedInService = String(input.placed_in_service ?? input.placedInService ?? "").trim();
  if (!isValidDateString(placedInService)) {
    return { ok: false, error: "Placed-in-service date is required (YYYY-MM-DD)." };
  }

  const method = String(input.method ?? "straight_line").trim();
  const methodDef = DEPRECIATION_METHODS[method];
  if (!methodDef) {
    return { ok: false, error: `Unsupported depreciation method. Use one of: ${Object.keys(DEPRECIATION_METHODS).join(", ")}.` };
  }

  const costBasisCents = toPositiveIntCents(input.cost_basis_cents ?? input.costBasisCents);
  if (costBasisCents === null || costBasisCents <= 0) {
    return { ok: false, error: "Cost basis must be a positive amount (in cents)." };
  }

  let usefulLifeMonths;
  if (methodDef.presetLifeMonths) {
    // MACRS methods lock the life to the preset — a caller-supplied life is
    // normalized away, never honored silently.
    usefulLifeMonths = methodDef.presetLifeMonths;
  } else {
    usefulLifeMonths = toPositiveIntCents(input.useful_life_months ?? input.usefulLifeMonths);
    if (usefulLifeMonths === null || usefulLifeMonths <= 0) {
      return { ok: false, error: "Useful life must be a positive number of months." };
    }
  }

  const salvageRaw = input.salvage_value_cents ?? input.salvageValueCents ?? 0;
  let salvageValueCents = toPositiveIntCents(salvageRaw);
  if (salvageValueCents === null || salvageValueCents < 0) {
    return { ok: false, error: "Salvage value must be zero or a positive amount (in cents)." };
  }
  if (methodDef.presetLifeMonths) {
    // MACRS tax depreciation does not recognize salvage value — the full
    // cost basis is recovered. Force to zero, like the preset life above,
    // so a stored salvage can never understate a MACRS schedule.
    salvageValueCents = 0;
  } else if (salvageValueCents >= costBasisCents) {
    return { ok: false, error: "Salvage value must be less than the cost basis — there has to be something to depreciate." };
  }

  const notes = String(input.notes ?? "").trim();

  return {
    ok: true,
    clean: {
      description,
      category,
      placed_in_service: placedInService,
      cost_basis_cents: costBasisCents,
      method,
      useful_life_months: usefulLifeMonths,
      salvage_value_cents: salvageValueCents,
      notes: notes || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Schedule engine
// ---------------------------------------------------------------------------

// Parses "YYYY-MM-DD" into { year, month } with month 1-12.
function parseYearMonth(dateString) {
  const [y, m] = dateString.split("-").map(Number);
  return { year: y, month: m };
}

// depreciableBasisCents(asset) → whole-cent depreciable basis.
// Straight line: cost - salvage. MACRS real-property presets: the full
// cost — IRS tax depreciation does not reduce depreciable basis by salvage
// value, so any stored salvage is ignored on read (validation already
// normalizes it to zero on write).
export function depreciableBasisCents(asset) {
  const methodDef = DEPRECIATION_METHODS[asset.method];
  if (methodDef?.presetLifeMonths) return asset.cost_basis_cents;
  return asset.cost_basis_cents - (asset.salvage_value_cents || 0);
}

// ---------------------------------------------------------------------------
// Schedule engine
// ---------------------------------------------------------------------------

// computeDepreciationSchedule(asset) → array of monthly entries:
//   { year, month (1-12), depreciationCents }.
// - Straight line: exactly usefulLifeMonths full months starting with the
//   placed-in-service month.
// - MACRS presets: mid-month convention — half a month in the first period,
//   full months after, and the leftover half month in the extra final
//   period (month N+1).
// Largest-remainder over half-month units keeps every entry whole cents and
// makes the schedule sum EXACTLY to the depreciable basis. A placed-in-service
// month mid-year naturally prorates the first calendar year.
export function computeDepreciationSchedule(asset) {
  const methodDef = DEPRECIATION_METHODS[asset.method];
  if (!methodDef) throw new Error(`Unsupported depreciation method: ${asset.method}`);
  const basis = depreciableBasisCents(asset);
  if (!Number.isInteger(basis) || basis <= 0) throw new Error("Depreciable basis must be a positive whole-cent amount.");

  const lifeMonths = asset.useful_life_months;
  if (!Number.isInteger(lifeMonths) || lifeMonths <= 0) throw new Error("Useful life must be a positive number of months.");

  // Period units: a full month is 2 units, a half month is 1 unit.
  const periodUnits = [];
  if (methodDef.midMonthConvention) {
    periodUnits.push(1);
    for (let i = 1; i < lifeMonths; i++) periodUnits.push(2);
    periodUnits.push(1);
  } else {
    for (let i = 0; i < lifeMonths; i++) periodUnits.push(2);
  }
  const totalUnits = periodUnits.reduce((sum, u) => sum + u, 0);
  const floorPerUnit = Math.floor(basis / totalUnits);
  const remainder = basis - floorPerUnit * totalUnits; // extra cents to hand out

  // Largest remainder: the first `remainder` units each get one extra cent.
  const unitCents = [];
  for (let i = 0; i < totalUnits; i++) unitCents.push(floorPerUnit + (i < remainder ? 1 : 0));

  const { year: startYear, month: startMonth } = parseYearMonth(asset.placed_in_service);
  const entries = [];
  let unitCursor = 0;
  for (let p = 0; p < periodUnits.length; p++) {
    const units = periodUnits[p];
    let amount = 0;
    for (let u = 0; u < units; u++) amount += unitCents[unitCursor++];
    const absoluteMonth = (startMonth - 1) + p;
    entries.push({
      year: startYear + Math.floor(absoluteMonth / 12),
      month: (absoluteMonth % 12) + 1,
      depreciationCents: amount,
    });
  }
  return entries;
}

// scheduleSummary(asset) → totals for one asset's full life.
export function scheduleSummary(asset) {
  const schedule = computeDepreciationSchedule(asset);
  const totalCents = schedule.reduce((sum, e) => sum + e.depreciationCents, 0);
  const basis = depreciableBasisCents(asset);
  return {
    assetId: asset.id ?? null,
    description: asset.description,
    depreciableBasisCents: basis,
    totalCents,
    periodCount: schedule.length,
    firstPeriod: { year: schedule[0].year, month: schedule[0].month },
    lastPeriod: { year: schedule[schedule.length - 1].year, month: schedule[schedule.length - 1].month },
    sumsToBasisExactly: totalCents === basis,
    schedule,
  };
}

// groupScheduleByYear(schedule) → [{ year, months: [{month, depreciationCents}], totalCents }]
export function groupScheduleByYear(schedule) {
  const byYear = new Map();
  for (const entry of schedule) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, []);
    byYear.get(entry.year).push(entry);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, months]) => ({
      year,
      months: [...months].sort((a, b) => a.month - b.month),
      totalCents: months.reduce((sum, e) => sum + e.depreciationCents, 0),
    }));
}

// ---------------------------------------------------------------------------
// Property-level report (the CPA hand-off)
// ---------------------------------------------------------------------------

// computePropertyDepreciationReport({ assets, year }) →
// {
//   year,
//   assets: [{ id, description, category, method, placedInService,
//              costBasisCents, salvageValueCents, depreciableBasisCents,
//              depreciationTakenCents (this year), accumulatedCents (through
//              end of year), remainingBookValueCents, scheduleByYear }],
//   totals: { costBasisCents, depreciableBasisCents, depreciationTakenCents,
//             accumulatedCents, remainingBookValueCents },
// }
// Book value = cost - accumulated depreciation. Report-only: no ledger writes.
export function computePropertyDepreciationReport({ assets = [], year }) {
  const reportYear = Number(year);
  if (!Number.isInteger(reportYear) || reportYear < 1900 || reportYear > 2200) {
    throw new Error("Report year must be a valid year.");
  }
  const rows = assets.map((asset) => {
    const schedule = computeDepreciationSchedule(asset);
    const byYear = groupScheduleByYear(schedule);
    const yearRow = byYear.find((row) => row.year === reportYear);
    const accumulatedCents = byYear
      .filter((row) => row.year <= reportYear)
      .reduce((sum, row) => sum + row.totalCents, 0);
    const basis = depreciableBasisCents(asset);
    return {
      id: asset.id ?? null,
      description: asset.description,
      category: asset.category,
      method: asset.method,
      placedInService: asset.placed_in_service,
      costBasisCents: asset.cost_basis_cents,
      salvageValueCents: asset.salvage_value_cents || 0,
      depreciableBasisCents: basis,
      depreciationTakenCents: yearRow ? yearRow.totalCents : 0,
      accumulatedCents,
      remainingBookValueCents: asset.cost_basis_cents - accumulatedCents,
      scheduleByYear: byYear,
    };
  });
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  return {
    year: reportYear,
    assets: rows,
    totals: {
      costBasisCents: sum("costBasisCents"),
      depreciableBasisCents: sum("depreciableBasisCents"),
      depreciationTakenCents: sum("depreciationTakenCents"),
      accumulatedCents: sum("accumulatedCents"),
      remainingBookValueCents: sum("remainingBookValueCents"),
    },
  };
}

// ---------------------------------------------------------------------------
// Row mapping (DB snake_case ↔ API camelCase)
// ---------------------------------------------------------------------------

export function rowToAsset(row) {
  return {
    id: row.id,
    propertyId: row.property_id,
    description: row.description,
    category: row.category,
    placedInService: row.placed_in_service,
    costBasisCents: row.cost_basis_cents,
    method: row.method,
    usefulLifeMonths: row.useful_life_months,
    salvageValueCents: row.salvage_value_cents,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
