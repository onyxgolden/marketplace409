// Work Package Planner slice 8 — Change Orders Log read model.
//
// Pure and deterministic: the application service supplies one snapshot
// (the control estimate, active change orders, stored craft rates, and
// planned labor hours per craft from the active step plan), and this
// module computes every running figure. Nothing derived is stored.
//
// Cost math (reproduces the real change-order form's running-price
// math; the migration header states the same rules in SQL terms):
//   * Canonical cost per change order: approved when set, else
//     estimated, else actual.
//   * Only status approved+ counts (approved, material_ordered,
//     requisition_filed, po_requested, po_approved). estimated-only
//     and denied change orders NEVER count.
//   * Running contract price = current estimate + counted
//     non-Deviation canonical costs.
//   * Contingency remaining = contingency pool - counted Deviation
//     canonical costs. Deviations never touch the contract price. A
//     negative remainder is reported as over-contingency, never
//     clamped to zero.
//   * Planned labor cost = sum over crafts of (planned person-hours
//     from the active step plan x that craft's rate). A craft with no
//     stored rate uses the $89/hr composite default. Steps with no
//     craft or no planned hours carry no labor cost.
//   * Total job cost = running contract price + planned labor cost.
//
// Money is integer cents throughout; labor hours carry at most two
// decimal places, so hours x rate-cents rounds to the nearest cent.

import { formatCents } from "./packageCosts.js";

/** Composite labor rate applied to any craft with no stored rate: $89/hr. */
export const DEFAULT_CRAFT_RATE_CENTS_PER_HOUR = 8900;
/** Stored rates are bounded the same way the migration CHECK bounds them. */
export const MAX_CRAFT_RATE_CENTS_PER_HOUR = 100000;
export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export const CHANGE_ORDER_TYPES = Object.freeze([
  { value: "bust", label: "Bust" },
  { value: "field_condition", label: "Field condition" },
  { value: "owner_directed", label: "Owner directed" },
  { value: "design_change", label: "Design change" },
  { value: "scope_addition", label: "Scope addition" },
  { value: "scope_deletion", label: "Scope deletion" },
  { value: "deviation", label: "Deviation" },
  { value: "other", label: "Other" },
]);

export const CHANGE_ORDER_TYPE_VALUES = Object.freeze(
  CHANGE_ORDER_TYPES.map((type) => type.value),
);

export const CHANGE_ORDER_STATUSES = Object.freeze([
  { value: "estimated", label: "Estimated" },
  { value: "approved", label: "Approved" },
  { value: "material_ordered", label: "Material ordered" },
  { value: "requisition_filed", label: "Requisition filed" },
  { value: "po_requested", label: "PO requested" },
  { value: "po_approved", label: "PO approved" },
  { value: "denied", label: "Denied" },
]);

export const CHANGE_ORDER_STATUS_VALUES = Object.freeze(
  CHANGE_ORDER_STATUSES.map((status) => status.value),
);

/** Statuses whose change orders count toward the running figures. */
export const COUNTED_STATUSES = Object.freeze([
  "approved",
  "material_ordered",
  "requisition_filed",
  "po_requested",
  "po_approved",
]);

/** The server-side transition table (the transition RPC enforces it). */
export const ALLOWED_TRANSITIONS = Object.freeze({
  estimated: ["approved", "denied"],
  approved: ["material_ordered", "denied"],
  material_ordered: ["requisition_filed", "denied"],
  requisition_filed: ["po_requested", "denied"],
  po_requested: ["po_approved", "denied"],
  po_approved: [],
  denied: [],
});

export const TERMINAL_PACKAGE_STATUSES = Object.freeze(["cancelled", "verified_closed"]);

export function changeOrderTypeLabel(type) {
  return CHANGE_ORDER_TYPES.find((entry) => entry.value === type)?.label ?? type ?? "—";
}

export function changeOrderStatusLabel(status) {
  return CHANGE_ORDER_STATUSES.find((entry) => entry.value === status)?.label ?? status ?? "—";
}

export function isCountedChangeOrder(order) {
  return Boolean(order) && COUNTED_STATUSES.includes(order.status);
}

/** Canonical cost: approved when set, else estimated, else actual, else null. */
export function canonicalCostCents(order) {
  if (!order) return null;
  if (order.approvedCostCents !== null && order.approvedCostCents !== undefined) {
    return order.approvedCostCents;
  }
  if (order.estimatedCostCents !== null && order.estimatedCostCents !== undefined) {
    return order.estimatedCostCents;
  }
  if (order.actualCostCents !== null && order.actualCostCents !== undefined) {
    return order.actualCostCents;
  }
  return null;
}

function normalizeCents(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(MAX_SAFE_CENTS)) return { ok: false };
    return { ok: true, cents: Number(value) };
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return { ok: false };
    return { ok: true, cents: value };
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const cents = BigInt(value.trim());
    if (cents > BigInt(MAX_SAFE_CENTS)) return { ok: false };
    return { ok: true, cents: Number(cents) };
  }
  return { ok: false };
}

function normalizeHours(value) {
  if (value === null || value === undefined) return { ok: true, hours: null };
  const hours = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(hours) || hours < 0 || Math.round(hours * 100) !== hours * 100) {
    return { ok: false };
  }
  return { ok: true, hours };
}

function fail(message) {
  return { ok: false, error: message };
}

function isNonEmptyText(value, maxLength) {
  return typeof value === "string"
    && value.trim().length >= 1
    && value.trim().length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function checkHeaderField(value, label, maxLength) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!isNonEmptyText(value, maxLength)) {
    return fail(`${label} must be ${maxLength} characters or fewer, with no control characters.`);
  }
  return { ok: true, value: value.trim() };
}

function checkCentsField(value, label) {
  if (value === null || value === undefined) return { ok: true, cents: null };
  const parsed = normalizeCents(value);
  if (!parsed.ok) return fail(`${label} must be a whole number of cents (0 or more).`);
  return { ok: true, cents: parsed.cents };
}

function checkReason(value, { required }) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return required ? fail("A reason is required for this change.") : { ok: true, reason: null };
  }
  if (String(value).trim().length > 1000) {
    return fail("Reason must be at most 1,000 characters.");
  }
  return { ok: true, reason: String(value).trim() };
}

/**
 * The running figures for one package, computed from one snapshot.
 * Every figure is exact integer cents (labor rounds to the nearest
 * cent); totals that would exceed the exact JS integer range are
 * reported unavailable instead of approximated.
 */
export function computeChangeOrderSummary({
  estimate = null,
  changeOrders = [],
  craftHours = [],
  craftRates = [],
  stepsWithoutCraftHours = 0,
} = {}) {
  const originalParsed = normalizeCents(estimate?.originalControlEstimateCents ?? null);
  const currentParsed = normalizeCents(estimate?.currentControlEstimateCents ?? null);
  const contingencyParsed = normalizeCents(estimate?.contingencyCents ?? null);
  // normalizeCents returns null for an absent value, so a missing
  // estimate (or a missing contingency pool) reads as null, never a
  // crash — the common case for a package with no control estimate yet.
  const originalControlEstimateCents = originalParsed?.ok ? originalParsed.cents : null;
  const currentEstimateCents = currentParsed?.ok ? currentParsed.cents : null;
  const contingencyCents = contingencyParsed?.ok ? contingencyParsed.cents : null;

  const countsByStatus = Object.fromEntries(
    CHANGE_ORDER_STATUS_VALUES.map((status) => [status, 0]),
  );
  let countedNonDeviationCents = 0n;
  let countedDeviationCents = 0n;
  let countedChangeOrderCount = 0;
  for (const order of changeOrders || []) {
    if (!order || !CHANGE_ORDER_STATUS_VALUES.includes(order.status)) continue;
    countsByStatus[order.status] += 1;
    if (!isCountedChangeOrder(order)) continue;
    const canonical = canonicalCostCents(order);
    if (canonical === null) continue;
    countedChangeOrderCount += 1;
    if (order.type === "deviation") {
      countedDeviationCents += BigInt(canonical);
    } else {
      countedNonDeviationCents += BigInt(canonical);
    }
  }

  const ratesByCraft = new Map();
  for (const rate of craftRates || []) {
    if (!rate?.craftKey) continue;
    const parsed = normalizeCents(rate.rateCentsPerHour);
    if (!parsed?.ok || parsed.cents < 1) continue;
    ratesByCraft.set(rate.craftKey, {
      rateCentsPerHour: parsed.cents,
      rateId: rate.id ?? null,
      version: rate.version ?? null,
      isDefaultRate: false,
    });
  }

  const laborByCraft = [];
  let laborCostCentsTotal = 0n;
  let laborOverflow = false;
  for (const craft of craftHours || []) {
    if (!craft?.craftKey) continue;
    const hoursParsed = normalizeHours(craft.plannedHours);
    if (!hoursParsed.ok || hoursParsed.hours === null) continue;
    const stored = ratesByCraft.get(craft.craftKey);
    const rateCentsPerHour = stored?.rateCentsPerHour ?? DEFAULT_CRAFT_RATE_CENTS_PER_HOUR;
    // Hours carry at most two decimals, so hours x cents rounds to the
    // nearest cent without floating-point drift at this scale.
    const laborCostCents = Math.round(hoursParsed.hours * rateCentsPerHour);
    if (!Number.isSafeInteger(laborCostCents) || laborCostCents < 0) {
      laborOverflow = true;
      continue;
    }
    laborCostCentsTotal += BigInt(laborCostCents);
    laborByCraft.push(Object.freeze({
      craftKey: craft.craftKey,
      craftLabel: craft.craftLabel ?? craft.craftKey,
      plannedHours: hoursParsed.hours,
      stepCount: craft.stepCount ?? 0,
      rateCentsPerHour,
      rateId: stored?.rateId ?? null,
      rateVersion: stored?.version ?? null,
      isDefaultRate: !stored,
      laborCostCents,
    }));
  }
  laborByCraft.sort((a, b) => String(a.craftLabel).localeCompare(String(b.craftLabel)));

  let runningContractPriceCents = null;
  let contingencyRemainingCents = null;
  let totalJobCostCents = null;
  let laborCostCents = null;
  let totalsError = null;
  if (laborOverflow || laborCostCentsTotal > BigInt(MAX_SAFE_CENTS)) {
    totalsError = {
      code: "labor_total_overflow",
      message: "The planned labor total is too large to count exactly, so package totals are unavailable instead of approximated.",
    };
  } else {
    laborCostCents = Number(laborCostCentsTotal);
    if (currentEstimateCents !== null) {
      const running = BigInt(currentEstimateCents) + countedNonDeviationCents;
      if (running > BigInt(MAX_SAFE_CENTS)) {
        totalsError = {
          code: "contract_total_overflow",
          message: "The running contract total is too large to count exactly, so package totals are unavailable instead of approximated.",
        };
      } else {
        runningContractPriceCents = Number(running);
        const total = running + laborCostCentsTotal;
        totalJobCostCents = total > BigInt(MAX_SAFE_CENTS) ? null : Number(total);
        if (totalJobCostCents === null) {
          totalsError = {
            code: "contract_total_overflow",
            message: "The running contract total is too large to count exactly, so package totals are unavailable instead of approximated.",
          };
        }
      }
    }
    if (contingencyCents !== null) {
      const remaining = BigInt(contingencyCents) - countedDeviationCents;
      if (remaining > BigInt(MAX_SAFE_CENTS) || remaining < -BigInt(MAX_SAFE_CENTS)) {
        totalsError = totalsError ?? {
          code: "contingency_total_overflow",
          message: "The contingency remainder is too large to count exactly, so package totals are unavailable instead of approximated.",
        };
        contingencyRemainingCents = null;
      } else {
        contingencyRemainingCents = Number(remaining);
      }
    }
  }
  if (totalsError && laborCostCents === null) laborCostCents = null;

  const warnings = [];
  if (stepsWithoutCraftHours > 0) {
    warnings.push({
      code: "steps_without_craft_hours",
      message: `${stepsWithoutCraftHours} active ${stepsWithoutCraftHours === 1 ? "step has" : "steps have"} no craft or no planned hours, so ${stepsWithoutCraftHours === 1 ? "it carries" : "they carry"} no labor cost.`,
    });
  }
  if (contingencyRemainingCents !== null && contingencyRemainingCents < 0) {
    warnings.push({
      code: "contingency_overdrawn",
      message: `Contingency is overdrawn by ${formatCents(Math.abs(contingencyRemainingCents))} — counted Deviations exceed the pool.`,
    });
  }
  if (totalsError) warnings.push({ code: totalsError.code, message: totalsError.message });

  return Object.freeze({
    hasEstimate: estimate !== null && estimate !== undefined,
    originalControlEstimateCents,
    currentEstimateCents,
    contingencyCents,
    runningContractPriceCents,
    contingencyRemainingCents,
    laborCostCents,
    totalJobCostCents,
    countsByStatus: Object.freeze(countsByStatus),
    countedChangeOrderCount,
    countedNonDeviationCents: Number(countedNonDeviationCents),
    countedDeviationCents: Number(countedDeviationCents),
    laborByCraft: Object.freeze(laborByCraft),
    stepsWithoutCraftHours,
    totalsError: totalsError ? Object.freeze(totalsError) : null,
    warnings: Object.freeze(warnings),
  });
}

export function validateChangeOrderCreateInput(input = {}) {
  if (!CHANGE_ORDER_TYPE_VALUES.includes(input.type)) {
    return fail("Type must be one of the change order types.");
  }
  if (!isNonEmptyText(input.description, 4000) || /<[a-zA-Z/][^>]*>/.test(input.description)) {
    return fail("Description is required (at most 4,000 characters, no markup).");
  }
  for (const [field, label, max] of [
    ["costCode", "Cost code", 80],
    ["afeNo", "AFE number", 80],
    ["referenceContractNo", "Reference contract number", 80],
    ["referencePoNumber", "Reference PO number", 80],
    ["initiatorName", "Initiator name", 120],
  ]) {
    const checked = checkHeaderField(input[field] ?? null, label, max);
    if (!checked.ok) return checked;
  }
  const estimated = checkCentsField(input.estimatedCostCents ?? null, "Estimated cost");
  if (!estimated.ok) return estimated;
  if (input.scheduleImpactDays !== null && input.scheduleImpactDays !== undefined) {
    const days = Number(input.scheduleImpactDays);
    if (!Number.isInteger(days) || days < -366 || days > 366) {
      return fail("Schedule impact must be a whole number of days from -366 to 366.");
    }
  }
  if (input.scheduleImpactNote !== null && input.scheduleImpactNote !== undefined
    && !isNonEmptyText(input.scheduleImpactNote, 1000)) {
    return fail("Schedule impact note must be at most 1,000 characters, with no control characters.");
  }
  const reason = checkReason(input.reason ?? null, { required: false });
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: Object.freeze({
      type: input.type,
      description: input.description.trim(),
      costCode: input.costCode?.trim() || null,
      afeNo: input.afeNo?.trim() || null,
      referenceContractNo: input.referenceContractNo?.trim() || null,
      referencePoNumber: input.referencePoNumber?.trim() || null,
      initiatorName: input.initiatorName?.trim() || null,
      estimatedCostCents: estimated.cents,
      scheduleImpactDays: input.scheduleImpactDays ?? null,
      scheduleImpactNote: input.scheduleImpactNote?.trim() || null,
      linkedStepId: input.linkedStepId || null,
      linkedDrawingId: input.linkedDrawingId || null,
      linkedTakeoffLineId: input.linkedTakeoffLineId || null,
      reason: reason.reason,
    }),
  };
}

export function validateChangeOrderUpdateInput(input = {}) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return fail("The change order version is required to save an edit.");
  }
  if (input.type !== null && input.type !== undefined
    && !CHANGE_ORDER_TYPE_VALUES.includes(input.type)) {
    return fail("Type must be one of the change order types.");
  }
  if (input.description !== null && input.description !== undefined
    && (!isNonEmptyText(input.description, 4000) || /<[a-zA-Z/][^>]*>/.test(input.description))) {
    return fail("Description is required (at most 4,000 characters, no markup).");
  }
  for (const [field, label] of [
    ["estimatedCostCents", "Estimated cost"],
    ["approvedCostCents", "Approved cost"],
    ["actualCostCents", "Actual cost"],
  ]) {
    if (input[field] !== undefined) {
      const checked = checkCentsField(input[field], label);
      if (!checked.ok) return checked;
    }
  }
  if (input.scheduleImpactDays !== null && input.scheduleImpactDays !== undefined) {
    const days = Number(input.scheduleImpactDays);
    if (!Number.isInteger(days) || days < -366 || days > 366) {
      return fail("Schedule impact must be a whole number of days from -366 to 366.");
    }
  }
  for (const [field, label, max] of [
    ["costCode", "Cost code", 80],
    ["afeNo", "AFE number", 80],
    ["referenceContractNo", "Reference contract number", 80],
    ["referencePoNumber", "Reference PO number", 80],
    ["initiatorName", "Initiator name", 120],
    ["poNumber", "PO number", 80],
  ]) {
    if (input[field] !== undefined) {
      const checked = checkHeaderField(input[field], label, max);
      if (!checked.ok) return checked;
    }
  }
  if (input.denialReason !== null && input.denialReason !== undefined
    && !isNonEmptyText(input.denialReason, 1000)) {
    return fail("Denial reason must be at most 1,000 characters, with no control characters.");
  }
  const reason = checkReason(input.reason ?? null, { required: true });
  if (!reason.ok) return reason;
  return { ok: true, value: Object.freeze({ ...input, reason: reason.reason }) };
}

export function validateChangeOrderTransitionInput(input = {}) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return fail("The change order version is required to move its status.");
  }
  if (!CHANGE_ORDER_STATUS_VALUES.includes(input.toStatus)
    || input.toStatus === "estimated") {
    // "estimated" is the starting status, never a destination: a
    // change order is born there and only moves forward (or to denied).
    return fail("Move to a valid change order status.");
  }
  if (input.poNumber !== null && input.poNumber !== undefined) {
    const checked = checkHeaderField(input.poNumber, "PO number", 80);
    if (!checked.ok) return checked;
  }
  if (input.denialReason !== null && input.denialReason !== undefined
    && !isNonEmptyText(input.denialReason, 1000)) {
    return fail("Denial reason must be at most 1,000 characters, with no control characters.");
  }
  if (input.approvedCostCents !== null && input.approvedCostCents !== undefined) {
    const checked = checkCentsField(input.approvedCostCents, "Approved cost");
    if (!checked.ok) return checked;
  }
  const reason = checkReason(input.reason ?? null, { required: true });
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: Object.freeze({
      expectedVersion: input.expectedVersion,
      toStatus: input.toStatus,
      poNumber: input.poNumber?.trim() || null,
      denialReason: input.denialReason?.trim() || null,
      approvedCostCents: input.approvedCostCents ?? null,
      reason: reason.reason,
    }),
  };
}

export function validateControlEstimateInput(input = {}) {
  const original = checkCentsField(input.originalCents ?? null, "Original control estimate");
  if (!original.ok || original.cents === null) {
    return fail("Original control estimate is required (a whole number of cents, 0 or more).");
  }
  const current = checkCentsField(input.currentCents ?? null, "Current estimate");
  if (!current.ok) return current;
  const contingency = checkCentsField(input.contingencyCents ?? null, "Contingency");
  if (!contingency.ok) return contingency;
  if (input.expectedVersion !== null && input.expectedVersion !== undefined
    && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) {
    return fail("The control estimate version is required to save an edit.");
  }
  const reason = checkReason(input.reason ?? null, { required: true });
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: Object.freeze({
      originalCents: original.cents,
      currentCents: current.cents,
      contingencyCents: contingency.cents,
      expectedVersion: input.expectedVersion ?? null,
      reason: reason.reason,
    }),
  };
}

export function validateCraftRateInput(input = {}) {
  if (!isNonEmptyText(input.craftKey, 80)) {
    return fail("A craft is required to set a labor rate.");
  }
  if (!isNonEmptyText(input.craftLabel, 80)
    || !/^[A-Za-z0-9][A-Za-z0-9 .&'/-]*$/.test(input.craftLabel.trim())) {
    return fail("Craft label must start with a letter or number and use only letters, numbers, spaces, and . & ' / -");
  }
  const rate = Number(input.rateCentsPerHour);
  if (!Number.isInteger(rate) || rate < 1 || rate > MAX_CRAFT_RATE_CENTS_PER_HOUR) {
    return fail(`Labor rate must be a whole number of cents per hour from 1 to ${MAX_CRAFT_RATE_CENTS_PER_HOUR}.`);
  }
  if (input.expectedVersion !== null && input.expectedVersion !== undefined
    && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) {
    return fail("The craft rate version is required to save an edit.");
  }
  const reason = checkReason(input.reason ?? null, { required: true });
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: Object.freeze({
      craftKey: input.craftKey.trim(),
      craftLabel: input.craftLabel.trim(),
      rateCentsPerHour: rate,
      expectedVersion: input.expectedVersion ?? null,
      reason: reason.reason,
    }),
  };
}

/** Parse a user-entered dollar amount to exact integer cents (or null for blank). */
export function parseDollarsToCents(value) {
  if (value === null || value === undefined) return { ok: true, cents: null };
  if (typeof value === "string" && value.trim() === "") return { ok: true, cents: null };
  const cleaned = String(value).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: "Enter a dollar amount with at most two decimal places." };
  }
  const [dollars, centsPart = ""] = cleaned.split(".");
  const cents = BigInt(dollars || "0") * 100n + BigInt((centsPart + "00").slice(0, 2));
  if (cents > BigInt(MAX_SAFE_CENTS)) {
    return { ok: false, error: "That amount is too large." };
  }
  return { ok: true, cents: Number(cents) };
}

/** Format a cents-per-hour rate as dollars per hour with two decimals. */
export function formatRatePerHour(rateCentsPerHour) {
  if (rateCentsPerHour === null || rateCentsPerHour === undefined) return "—";
  return `$${(rateCentsPerHour / 100).toFixed(2)}/hr`;
}

export { formatCents };
