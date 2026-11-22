// D2b budget allocation (planner dashboard rebuild) — pure domain.
//
// A budget allocation is an auditable five-way split of a work
// package's ACTIVE CONTROL ESTIMATE (forge_work_control_estimates.
// current_estimate_cents) — never of the legacy planned_cost_cents,
// which Slice 8 superseded. Exactly five FIXED categories; they are
// not client-configurable.
//
// A saved allocation is atomic and exact: its positive line amounts
// must sum to the package's current control estimate. The browser
// keeps an editable draft until it balances; there is no endpoint
// for an unreconciled partial database save.
//
// Change orders get NO budget lines in D2b (a separate future slice
// must decide status eligibility and whether category changes revise
// the base budget or the forecast). No category is ever inferred from
// free-text cost_code, description, PO, linked step, or takeoff line.
//
// Labor: the Slice 8 planned labor forecast (active step hours x
// package craft rates) is a COMPARISON only — it is never added to
// the five-way total, and a later step/rate edit never rewrites an
// approved allocation. "Use planned labor estimate" copies the
// forecast into a DRAFT Labor line; the user confirms it by saving.

export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;
export const MAX_BUDGET_LINES = 100;
export const MAX_BUDGET_LINE_DESCRIPTION_LENGTH = 200;
export const MAX_BUDGET_REASON_LENGTH = 1000;
export const MAX_COST_SPLIT_PACKAGE_IDS = 500;

// Exactly five fixed categories (brief §executive decision). Order is
// the dashboard order: labor first, rental last.
export const BUDGET_CATEGORIES = Object.freeze([
  { value: "labor", label: "Labor", color: "#2563eb" },
  { value: "material", label: "Material", color: "#0d9488" },
  { value: "equipment", label: "Equipment", color: "#d97706" },
  { value: "external_services", label: "External services", color: "#4f46e5" },
  { value: "rental", label: "Rental", color: "#64748b" },
]);

export const BUDGET_CATEGORY_VALUES = Object.freeze(BUDGET_CATEGORIES.map((c) => c.value));

const CATEGORY_BY_VALUE = new Map(BUDGET_CATEGORIES.map((c) => [c.value, c]));

export function isBudgetCategory(value) {
  return typeof value === "string" && CATEGORY_BY_VALUE.has(value);
}

export function budgetCategoryLabel(value) {
  return CATEGORY_BY_VALUE.get(value)?.label ?? String(value ?? "");
}

export function budgetCategoryColor(value) {
  return CATEGORY_BY_VALUE.get(value)?.color ?? "#94a3b8";
}

function fail(error) {
  return { ok: false, error };
}

function isNonEmptyText(value, maxLength) {
  return typeof value === "string"
    && value.trim().length >= 1
    && value.trim().length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function hasHtmlShape(value) {
  return /<[a-zA-Z/][^>]*>/.test(value);
}

function checkReason(value, { required }) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return required ? fail("A reason is required for this change.") : { ok: true, reason: null };
  }
  if (String(value).trim().length > MAX_BUDGET_REASON_LENGTH) {
    return fail("Reason must be at most 1,000 characters.");
  }
  if (/[\u0000-\u001f\u007f]/.test(String(value))) {
    return fail("Reason must not contain control characters.");
  }
  return { ok: true, reason: String(value).trim() };
}

function checkVersion(value, { required = false } = {}) {
  if (value === null || value === undefined) {
    return required ? fail("A version is required.") : { ok: true, version: null };
  }
  if (!Number.isInteger(value) || value < 0) {
    return fail("Version must be a whole number (0 or more).");
  }
  return { ok: true, version: value };
}

/**
 * Validate one allocation line (client shape: { id?, category,
 * description, amountCents }). Amounts are integer cents and must be
 * POSITIVE — zero-dollar rows are not stored; deleting a row is the
 * truthful zero. Description is 1–200 chars, no control characters,
 * no HTML-shaped input.
 */
export function validateBudgetLine(line = {}) {
  if (!isBudgetCategory(line?.category)) {
    return fail("Category must be labor, material, equipment, external services, or rental.");
  }
  if (!isNonEmptyText(line?.description, MAX_BUDGET_LINE_DESCRIPTION_LENGTH) || hasHtmlShape(line.description)) {
    return fail("Description is required (1–200 characters, no markup).");
  }
  const amount = line?.amountCents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1) {
    return fail("Amount must be a whole number of cents (1 or more).");
  }
  if (line?.id !== null && line?.id !== undefined && (typeof line.id !== "string" || line.id.trim() === "")) {
    return fail("A line id, when given, must be a non-empty string.");
  }
  return {
    ok: true,
    value: Object.freeze({
      id: line.id ?? null,
      category: line.category,
      description: line.description.trim(),
      amountCents: amount,
    }),
  };
}

/**
 * Validate a full-set allocation replace (client shape). The sum rule
 * (lines must equal the current control estimate exactly) is enforced
 * by the RPC against the locked estimate — the domain checks shape
 * only, so a shape-valid draft can still be refused server-side when
 * the estimate moved or the lines do not balance.
 */
export function validateBudgetAllocationInput(input = {}) {
  const version = checkVersion(input.expectedAllocationVersion ?? null);
  if (!version.ok) return version;
  if (typeof input.expectedEstimateId !== "string" || input.expectedEstimateId.trim() === "") {
    return fail("The control estimate this allocation reconciles to is required.");
  }
  const estimateVersion = checkVersion(input.expectedEstimateVersion ?? null, { required: true });
  if (!estimateVersion.ok) return estimateVersion;
  if (estimateVersion.version < 1) {
    return fail("The control estimate version must be 1 or more.");
  }
  const reason = checkReason(input.reason ?? null, { required: true });
  if (!reason.ok) return reason;
  const lines = input.lines;
  if (!Array.isArray(lines)) {
    return fail("Lines must be a list of budget lines.");
  }
  if (lines.length > MAX_BUDGET_LINES) {
    return fail(`An allocation holds at most ${MAX_BUDGET_LINES} lines.`);
  }
  const seenIds = new Set();
  const checkedLines = [];
  for (const line of lines) {
    const checked = validateBudgetLine(line);
    if (!checked.ok) return checked;
    if (checked.value.id !== null) {
      if (seenIds.has(checked.value.id)) {
        return fail("Each line may appear only once in an allocation.");
      }
      seenIds.add(checked.value.id);
    }
    checkedLines.push(checked.value);
  }
  return {
    ok: true,
    value: Object.freeze({
      expectedAllocationVersion: version.version,
      expectedEstimateId: input.expectedEstimateId.trim(),
      expectedEstimateVersion: estimateVersion.version,
      reason: reason.reason,
      lines: Object.freeze(checkedLines),
    }),
  };
}

/** Validate a retire (delete allocation) input: version guard + required reason. */
export function validateBudgetAllocationRetireInput(input = {}) {
  const version = checkVersion(input.expectedVersion ?? null, { required: true });
  if (!version.ok) return version;
  if (version.version < 1) {
    return fail("The allocation version is required to delete it.");
  }
  const reason = checkReason(input.reason ?? null, { required: true });
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: Object.freeze({ expectedVersion: version.version, reason: reason.reason }),
  };
}

/** Parse a user-entered dollar amount for one budget line to exact integer cents. Must be positive. */
export function parseBudgetLineAmountToCents(value) {
  if (value === null || value === undefined) return { ok: false, error: "Amount is required." };
  const text = String(value).trim();
  if (text === "") return { ok: false, error: "Amount is required." };
  const cleaned = text.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: "Amount must be a dollar amount with at most two decimal places." };
  }
  const [dollars, centsPart = ""] = cleaned.split(".");
  const cents = BigInt(dollars || "0") * 100n + BigInt((centsPart + "00").slice(0, 2) || "0");
  if (cents < 1n || cents > BigInt(MAX_SAFE_CENTS)) {
    return { ok: false, error: "Amount must be more than $0.00 and fit in whole cents." };
  }
  return { ok: true, cents: Number(cents) };
}

function emptyCategoryTotals() {
  return Object.fromEntries(BUDGET_CATEGORY_VALUES.map((value) => [value, 0]));
}

function emptyCategoryCounts() {
  return Object.fromEntries(BUDGET_CATEGORY_VALUES.map((value) => [value, 0]));
}

function normalizeCents(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(MAX_SAFE_CENTS) ? Number(value) : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = BigInt(value.trim());
    return parsed <= BigInt(MAX_SAFE_CENTS) ? Number(parsed) : null;
  }
  return null;
}

/**
 * Summarize the project cost split from the bulk snapshot.
 *
 * - packages: the in-scope listWorkPackages rows (at least { id }).
 * - costByPackage: map package id -> { estimate: { id, version,
 *   currentEstimateCents } | null, allocation: { id, version,
 *   estimateId, estimateVersion, categoryTotals } | null, reconciled,
 *   reason } — null when the snapshot is unavailable (migration not
 *   applied): the summary is unavailable, never a false zero.
 *
 * Rules (brief §6): the strip total is the sum of ACTIVE control
 * estimates only — packages without an estimate are excluded and
 * counted, never a false $0; category amounts sum SAVED RECONCILED
 * allocation lines only; a package appears in a category count when
 * its category total is greater than zero (counts overlap across
 * categories and are never added together); when complete, the five
 * category amounts add exactly to the strip total. A stale or
 * missing allocation never renders as reconciled.
 */
export function summarizeCostSplit({ packages = [], costByPackage = null } = {}) {
  const rows = Array.isArray(packages) ? packages : [];
  if (costByPackage === null || costByPackage === undefined) {
    return {
      unavailable: true,
      totalControlEstimateCents: 0,
      hasControlEstimate: false,
      estimatedPackageCount: 0,
      noEstimatePackageCount: 0,
      categoryTotals: emptyCategoryTotals(),
      categoryPackageCounts: emptyCategoryCounts(),
      reconciledPackageCount: 0,
      unallocatedPackageCount: 0,
      unallocatedEstimateCents: 0,
      complete: false,
      perPackage: {},
    };
  }
  const map = costByPackage && typeof costByPackage === "object" ? costByPackage : {};
  let totalControlEstimateCents = 0;
  let hasControlEstimate = false;
  let estimatedPackageCount = 0;
  let noEstimatePackageCount = 0;
  let reconciledPackageCount = 0;
  let unallocatedPackageCount = 0;
  let unallocatedEstimateCents = 0;
  const categoryTotals = emptyCategoryTotals();
  const categoryPackageCounts = emptyCategoryCounts();
  const perPackage = {};
  for (const pkg of rows) {
    const entry = map[pkg?.id] || null;
    const estimateCents = normalizeCents(entry?.estimate?.currentEstimateCents ?? null);
    const reconciled = entry?.reconciled === true && estimateCents !== null;
    perPackage[pkg?.id] = {
      reconciled,
      reason: reconciled ? null : (entry?.reason ?? "no_estimate"),
    };
    if (estimateCents === null) {
      noEstimatePackageCount += 1;
      continue;
    }
    estimatedPackageCount += 1;
    hasControlEstimate = true;
    totalControlEstimateCents += estimateCents;
    if (!reconciled) {
      unallocatedPackageCount += 1;
      unallocatedEstimateCents += estimateCents;
      continue;
    }
    reconciledPackageCount += 1;
    const totals = entry?.allocation?.categoryTotals || {};
    for (const value of BUDGET_CATEGORY_VALUES) {
      const amount = normalizeCents(totals[value] ?? 0) ?? 0;
      categoryTotals[value] += amount;
      if (amount > 0) categoryPackageCounts[value] += 1;
    }
  }
  return {
    unavailable: false,
    totalControlEstimateCents,
    hasControlEstimate,
    estimatedPackageCount,
    noEstimatePackageCount,
    categoryTotals,
    categoryPackageCounts,
    reconciledPackageCount,
    unallocatedPackageCount,
    unallocatedEstimateCents,
    complete: estimatedPackageCount > 0 && unallocatedPackageCount === 0,
    perPackage,
  };
}

/**
 * Labor comparison for the package editor: the saved Labor budget
 * against the current Slice 8 planned labor forecast. The forecast is
 * a comparison only — it is never added to the five-way total.
 * Returns nulls when either side is unknown.
 */
export function computeLaborVariance({ laborBudgetCents = null, plannedLaborForecastCents = null } = {}) {
  const budget = normalizeCents(laborBudgetCents);
  const forecast = normalizeCents(plannedLaborForecastCents);
  if (budget === null || forecast === null) {
    return { laborBudgetCents: budget, plannedLaborForecastCents: forecast, varianceCents: null, wording: null };
  }
  const varianceCents = budget - forecast;
  const wording = varianceCents > 0
    ? "over the planned labor estimate"
    : varianceCents < 0
      ? "under the planned labor estimate"
      : "matches the planned labor estimate";
  return { laborBudgetCents: budget, plannedLaborForecastCents: forecast, varianceCents, wording };
}
