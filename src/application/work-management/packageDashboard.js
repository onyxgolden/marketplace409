// D4.1 package dashboard — pure summarizers for the package detail
// dashboard on /forge/work/[packageId].
//
// Everything here computes from already-authorized reads (the server-
// loaded detail + planning summary, the work-steps list, the D2b budget
// allocation snapshot, the slice-8 change-order summary). No new queries,
// no new model. Every function is honest about what it cannot know:
// missing or unreconciled data stays an explicit incomplete state —
// never a zero, never a guessed percent.
import {
  BUDGET_CATEGORY_VALUES,
  isBudgetCategory,
} from "@/domains/work-management/budgetAllocations";
import { isCountedChangeOrder } from "@/domains/work-management/changeOrders";

export const NO_CRAFT_KEY = "no-craft";

/** Canonical group key for one work step: stored key, else a normalized label, else the explicit missing bucket. */
export function craftGroupKey(step) {
  const stored = typeof step?.craftKey === "string" ? step.craftKey.trim() : "";
  if (stored) return stored;
  const label = typeof step?.craftLabel === "string" ? step.craftLabel.trim().toLowerCase() : "";
  return label || NO_CRAFT_KEY;
}

/** Display label for one work step's craft group. */
export function craftGroupLabel(step) {
  const label = typeof step?.craftLabel === "string" ? step.craftLabel.trim() : "";
  if (label) return label;
  const key = typeof step?.craftKey === "string" ? step.craftKey.trim() : "";
  return key || "No craft";
}

function isMissingHours(value) {
  return value === null || value === undefined || typeof value !== "number" || !Number.isFinite(value) || value < 0;
}

function sortCraftGroups(groups) {
  // Biggest planned-hours first, step count then label on ties — the
  // missing-craft bucket always sorts last, like the D2 progress
  // groups: it is the least informative group and must never outrank
  // a named craft.
  return groups.sort((a, b) => {
    const aNone = a.key === NO_CRAFT_KEY;
    const bNone = b.key === NO_CRAFT_KEY;
    if (aNone !== bNone) return aNone ? 1 : -1;
    return b.plannedHours - a.plannedHours
      || b.stepCount - a.stepCount
      || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  });
}

/**
 * Group active work steps by craft for the "Work plan by craft" block.
 *
 * Retired steps are not part of the plan and are excluded. Each group
 * carries the planned step count and the sum of valid planned person-
 * hours; steps with no usable hours count in hoursMissingCount and
 * never contribute a guessed number. This is planned inventory only —
 * it says nothing about completion (D4.2, blocked).
 */
export function summarizeWorkPlanByCraft(steps) {
  const rows = Array.isArray(steps) ? steps : [];
  const byKey = new Map();
  let totalSteps = 0;
  let totalPlannedHours = 0;
  let hoursMissingCount = 0;
  for (const step of rows) {
    if (!step || step.retiredAt != null) continue;
    totalSteps += 1;
    const key = craftGroupKey(step);
    const label = craftGroupLabel(step);
    const entry = byKey.get(key) || { key, label, stepCount: 0, plannedHours: 0, hoursMissingCount: 0 };
    entry.stepCount += 1;
    if (isMissingHours(step.plannedPersonHours)) {
      entry.hoursMissingCount += 1;
      hoursMissingCount += 1;
    } else {
      entry.plannedHours += step.plannedPersonHours;
      totalPlannedHours += step.plannedPersonHours;
    }
    byKey.set(key, entry);
  }
  return {
    groups: sortCraftGroups([...byKey.values()]),
    totalSteps,
    totalPlannedHours,
    hoursMissingCount,
    hasHours: totalPlannedHours > 0,
  };
}

function emptyCategoryTotals() {
  return Object.fromEntries(BUDGET_CATEGORY_VALUES.map((value) => [value, 0]));
}

function isValidLineAmount(amount) {
  // D2b contract (validateBudgetLine): amounts are integer cents, 1 or
  // more. Zero-dollar rows are not stored — deleting a row is the
  // truthful zero — so a stored 0, null, fractional, or non-number
  // amount is malformed data, never a value to normalize.
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 1;
}

function describeLineProblems(problems) {
  const counts = {};
  for (const problem of problems) counts[problem.problem] = (counts[problem.problem] || 0) + 1;
  const parts = [];
  if (counts["unknown-category"]) {
    parts.push(`${counts["unknown-category"]} ${counts["unknown-category"] === 1 ? "line has" : "lines have"} an unknown category`);
  }
  if (counts["invalid-amount"]) {
    parts.push(`${counts["invalid-amount"]} ${counts["invalid-amount"] === 1 ? "line has" : "lines have"} a missing or invalid amount`);
  }
  if (counts["duplicate-id"]) {
    parts.push(`${counts["duplicate-id"]} ${counts["duplicate-id"] === 1 ? "line is" : "lines are"} duplicated`);
  }
  if (counts["invalid-lines"]) parts.push("the saved lines are not a list");
  if (counts["invalid-line"]) {
    parts.push(`${counts["invalid-line"]} ${counts["invalid-line"] === 1 ? "line is" : "lines are"} malformed`);
  }
  return parts.join("; ");
}

/**
 * The five-way cost split for one package, from the D2b allocation
 * snapshot (getBudgetAllocation shape).
 *
 * States, in precedence order:
 * - not-applied: the D2b migration has not landed — the feature is unavailable.
 * - no-estimate: no control estimate exists yet.
 * - no-allocation: an estimate exists but no allocation was saved.
 * - stale: the allocation was saved against an older estimate version.
 * - mismatch: the version matches but the split does not reconcile —
 *   the lines carry an unknown category, a malformed amount, or a
 *   duplicate id; the valid lines do not sum to the saved allocation
 *   total; the saved total is missing or invalid; or the saved total
 *   differs from the current estimate. The write path should prevent
 *   all of these, but the read side never silently normalizes them.
 * - reconciled: every line is valid, and the five-category line sum
 *   equals the saved allocation total, which equals the current
 *   control estimate, at the matching version.
 *
 * A state other than reconciled carries no chart: the widget renders
 * the incomplete state instead. gapCents is the allocated total minus
 * the estimate (negative when short), null when either side is unknown
 * or invalid. lineSumCents is the sum of the valid lines only —
 * malformed lines are excluded, never coerced to zero. A category with
 * no lines is a real zero (D2b stores no zero-dollar rows), and it
 * reconciles fine.
 */
export function summarizePackageCostSplit(data = {}) {
  const estimate = data?.estimate || null;
  const allocation = data?.allocation || null;
  const estimateCents = estimate?.currentControlEstimateCents ?? null;
  const allocatedTotalCents = allocation?.allocatedTotalCents ?? null;
  const categoryTotals = emptyCategoryTotals();
  let lineCount = 0;
  let lineSumCents = 0;
  const lineProblems = [];
  const lines = Array.isArray(allocation?.lines) ? allocation.lines : [];
  if (allocation != null && !Array.isArray(allocation.lines)) {
    lineProblems.push({ index: -1, id: null, problem: "invalid-lines" });
  }
  const seenIds = new Set();
  lines.forEach((line, index) => {
    if (!line || typeof line !== "object") {
      lineProblems.push({ index, id: null, problem: "invalid-line" });
      return;
    }
    if (!isBudgetCategory(line.category)) {
      lineProblems.push({ index, id: line.id ?? null, problem: "unknown-category" });
      return;
    }
    if (!isValidLineAmount(line.amountCents)) {
      lineProblems.push({ index, id: line.id ?? null, problem: "invalid-amount" });
      return;
    }
    if (line.id != null) {
      if (seenIds.has(line.id)) {
        lineProblems.push({ index, id: line.id, problem: "duplicate-id" });
        return;
      }
      seenIds.add(line.id);
    }
    lineCount += 1;
    lineSumCents += line.amountCents;
    categoryTotals[line.category] += line.amountCents;
  });
  const totalsAreIntegers = Number.isSafeInteger(estimateCents) && Number.isSafeInteger(allocatedTotalCents);
  let state;
  let reason;
  if (data?.notApplied) {
    state = "not-applied";
    reason = "Budget allocation isn't available yet — the database change for this feature hasn't been applied.";
  } else if (estimate == null) {
    state = "no-estimate";
    reason = "No control estimate set — set the control estimate first, then split it five ways.";
  } else if (allocation == null) {
    state = "no-allocation";
    reason = "No budget allocation yet — split the control estimate five ways to see the cost split.";
  } else if (allocation.controlEstimateVersion !== estimate.version) {
    state = "stale";
    reason = "The control estimate changed since this allocation was saved — the split is stale, not reconciled.";
  } else if (lineProblems.length > 0) {
    state = "mismatch";
    reason = `The saved budget lines include ${describeLineProblems(lineProblems)} — the split is not reconciled.`;
  } else if (!Number.isSafeInteger(allocatedTotalCents)) {
    state = "mismatch";
    reason = "The saved allocation total is missing or invalid — the split is not reconciled.";
  } else if (!Number.isSafeInteger(estimateCents)) {
    state = "mismatch";
    reason = "The control estimate amount is missing or invalid — the split is not reconciled.";
  } else if (lineSumCents !== allocatedTotalCents) {
    state = "mismatch";
    reason = "The budget lines do not add up to the saved allocation total — the split is not reconciled.";
  } else if (allocatedTotalCents !== estimateCents) {
    state = "mismatch";
    reason = "The budget lines do not add up to the current control estimate — the split is not reconciled.";
  } else {
    state = "reconciled";
    reason = null;
  }
  return {
    state,
    reason,
    estimateCents,
    allocatedTotalCents,
    gapCents: totalsAreIntegers ? allocatedTotalCents - estimateCents : null,
    categoryTotals,
    lineCount,
    lineSumCents,
    lineProblems,
    plannedLaborForecastCents: data?.plannedLaborForecastCents ?? null,
  };
}

/**
 * The change-order strip for one package, from the slice-8 summary
 * (computeChangeOrderSummary shape).
 *
 * Open = every active status except denied (retired rows are not in
 * the summary's active list). Approved value = counted non-Deviation +
 * counted Deviation cents. Contingency remaining stays negative when
 * overdrawn — never clamped. When there is no estimate, the
 * estimate-derived figures are null and the state is no-estimate, but
 * the open count and approved value still show: they need no estimate.
 */
export function summarizeChangeOrderStrip(summary = {}) {
  const countsByStatus = summary?.countsByStatus || {};
  let openCount = 0;
  let deniedCount = 0;
  for (const [status, count] of Object.entries(countsByStatus)) {
    const n = typeof count === "number" && Number.isFinite(count) ? count : 0;
    if (status === "denied") deniedCount += n;
    else openCount += n;
  }
  const countedNonDeviationCents = summary?.countedNonDeviationCents ?? 0;
  const countedDeviationCents = summary?.countedDeviationCents ?? 0;
  let state;
  if (summary?.notApplied) state = "not-applied";
  else if (!summary?.hasEstimate) state = "no-estimate";
  else state = "ready";
  return {
    state,
    openCount,
    deniedCount,
    countedCount: summary?.countedChangeOrderCount ?? 0,
    countedNonDeviationCents,
    countedDeviationCents,
    approvedValueCents: countedNonDeviationCents + countedDeviationCents,
    contingencyCents: summary?.contingencyCents ?? null,
    contingencyUsedCents: countedDeviationCents,
    contingencyRemainingCents: summary?.contingencyRemainingCents ?? null,
    runningContractPriceCents: summary?.runningContractPriceCents ?? null,
    hasEstimate: Boolean(summary?.hasEstimate),
    warnings: Array.isArray(summary?.warnings) ? summary.warnings : [],
  };
}

// -- Detail-focus handoff -------------------------------------------------
// A dashboard drill changes only the detail page's presentation target:
// the tab plus an allowlisted focus the receiving tab applies locally.
// The focus is serialized into ?detailFocus= so a drill survives a
// reload; raw query text is never rendered — the receiving tab matches
// the parsed focus against its own data and shows the data's own label.

const CHANGE_ORDER_FILTERS = ["open", "counted", "deviation", "all"];
const CRAFT_KEY_PATTERN = /^[A-Za-z0-9 _.'/-]{1,80}$/;

function isValidCraftKey(value) {
  return typeof value === "string" && CRAFT_KEY_PATTERN.test(value);
}

/**
 * Parse a ?detailFocus= value into a focus object, or null when the
 * value is absent, malformed, or outside the allowlist.
 */
export function parseDetailFocus(value) {
  if (typeof value !== "string" || value === "") return null;
  if (value === "estimate") return { kind: "estimate" };
  const [kind, rest] = value.split(":");
  if (rest === undefined || rest === "" || value.split(":").length !== 2) return null;
  if (kind === "craft") {
    return isValidCraftKey(rest) ? { kind: "craft", craftKey: rest } : null;
  }
  if (kind === "change-orders") {
    return CHANGE_ORDER_FILTERS.includes(rest) ? { kind: "change-orders", filter: rest } : null;
  }
  if (kind === "budget-allocation") {
    if (rest === "all") return { kind: "budget-allocation", category: "all" };
    return isBudgetCategory(rest) ? { kind: "budget-allocation", category: rest } : null;
  }
  return null;
}

/** Serialize a focus object for ?detailFocus=, or null when there is no focus. */
export function serializeDetailFocus(focus) {
  if (!focus || typeof focus !== "object") return null;
  if (focus.kind === "estimate") return "estimate";
  if (focus.kind === "craft") {
    return isValidCraftKey(focus.craftKey) ? `craft:${focus.craftKey}` : null;
  }
  if (focus.kind === "change-orders") {
    return CHANGE_ORDER_FILTERS.includes(focus.filter) ? `change-orders:${focus.filter}` : null;
  }
  if (focus.kind === "budget-allocation") {
    if (focus.category === "all") return "budget-allocation:all";
    return isBudgetCategory(focus.category) ? `budget-allocation:${focus.category}` : null;
  }
  return null;
}

// -- Planning display helpers --------------------------------------------
// These take the progress object (planningSummary.progress), not the
// whole summary: "Steps done / total" is checklist credit/status
// completion — the progress object exposes the exact earned step count
// and the 22-step template denominator, so the strip may show it. The
// percent is always the canonical credit-weighted planning % — never
// execution percent.

export function planningStepsDisplay(summary) {
  if (!summary) return "Unavailable";
  if (!summary.initialized) return "Not started";
  return `${summary.stepsEarned} of ${summary.stepsTotal} steps`;
}

export function planningPercentDisplay(summary) {
  if (!summary) return "Unavailable";
  if (!summary.initialized) return "Not started — 0%";
  return `${summary.percentComplete}%`;
}

// Re-exported for callers that filter rows by a counted order.
export { isCountedChangeOrder };
