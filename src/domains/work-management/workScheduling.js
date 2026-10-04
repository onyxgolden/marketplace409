// FORGE Work Management — Scheduling domain (Rung 4).
//
// Pure, deterministic domain logic: no DB, no network, no Date.now().
// The FIXED calculation engine — earned value, percent complete, PPC,
// ETC/EAC, manpower variance. One math, never alternative math; per-client
// config is labels + thresholds + weights, never different formulas.
//
// Measurement methods (stored on the package, Rung 4 migration):
//   physical_quantity — installed quantities vs planned quantities.
//   milestone         — weighted milestones achieved vs total weight.
//   rules_of_credit   — fixed % credits per completed step.

export const PROGRESS_METHODS = Object.freeze([
  "physical_quantity",
  "milestone",
  "rules_of_credit",
]);

export const WEIGHT_METHODS = Object.freeze(["cost", "hours", "quantity", "manual"]);

function assertFinite(n, name) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`scheduling: ${name} must be a finite number`);
  }
}

function assertPct(p, name) {
  assertFinite(p, name);
  if (p < 0 || p > 100) throw new Error(`scheduling: ${name} must be 0-100`);
}

function assertMethod(method, allowed, name) {
  if (!allowed.includes(method)) {
    throw new Error(`scheduling: unknown ${name} "${method}"`);
  }
}

// Percent complete from physical quantities: installed / planned * 100.
// Guards the divide-by-zero: nothing planned means 0% (not NaN, not 100).
export function percentCompletePhysical(installedQty, plannedQty) {
  assertFinite(installedQty, "installedQty");
  assertFinite(plannedQty, "plannedQty");
  if (plannedQty <= 0) return 0;
  if (installedQty <= 0) return 0;
  return Math.min(100, (installedQty / plannedQty) * 100);
}

// Percent complete from weighted milestones: sum(achieved weights) /
// sum(all weights) * 100. Each milestone: { weight, achieved: bool }.
export function percentCompleteMilestone(milestones) {
  if (!Array.isArray(milestones)) throw new Error("scheduling: milestones must be an array");
  let total = 0;
  let achieved = 0;
  for (const m of milestones) {
    assertFinite(m.weight, "milestone.weight");
    if (m.weight < 0) throw new Error("scheduling: milestone weight must be >= 0");
    total += m.weight;
    if (m.achieved) achieved += m.weight;
  }
  if (total <= 0) return 0;
  return Math.min(100, (achieved / total) * 100);
}

// Percent complete from rules of credit: each completed step earns its
// fixed credit. Steps: { credit, complete: bool }. Credits must sum to 100.
export function percentCompleteRulesOfCredit(steps) {
  if (!Array.isArray(steps)) throw new Error("scheduling: steps must be an array");
  let earned = 0;
  for (const s of steps) {
    assertFinite(s.credit, "step.credit");
    if (s.credit < 0) throw new Error("scheduling: step credit must be >= 0");
    if (s.complete) earned += s.credit;
  }
  return Math.min(100, earned);
}

// Dispatch to the package's configured measurement method.
export function percentComplete(method, input) {
  assertMethod(method, PROGRESS_METHODS, "progress method");
  switch (method) {
    case "physical_quantity":
      return percentCompletePhysical(input.installedQty, input.plannedQty);
    case "milestone":
      return percentCompleteMilestone(input.milestones);
    case "rules_of_credit":
      return percentCompleteRulesOfCredit(input.steps);
  }
}

// Earned value: % complete × budget at completion. Works for hours or cost
// — the caller picks the unit by passing the matching BAC.
export function earnedValue(pctComplete, budgetAtCompletion) {
  assertPct(pctComplete, "pctComplete");
  assertFinite(budgetAtCompletion, "budgetAtCompletion");
  if (budgetAtCompletion < 0) throw new Error("scheduling: BAC must be >= 0");
  return (pctComplete / 100) * budgetAtCompletion;
}

// Planned value at a status date: baseline budget × planned %.
// Planned % comes from the baseline schedule (time elapsed / duration),
// computed by the caller — this function is the pure multiplication.
export function plannedValue(plannedPct, budgetAtCompletion) {
  assertPct(plannedPct, "plannedPct");
  assertFinite(budgetAtCompletion, "budgetAtCompletion");
  return (plannedPct / 100) * budgetAtCompletion;
}

// Cost/schedule variances and indices (standard EVM).
export function costVariance(earned, actual) {
  assertFinite(earned, "earned");
  assertFinite(actual, "actual");
  return earned - actual;
}
export function scheduleVariance(earned, planned) {
  assertFinite(earned, "earned");
  assertFinite(planned, "planned");
  return earned - planned;
}
export function costPerformanceIndex(earned, actual) {
  assertFinite(earned, "earned");
  assertFinite(actual, "actual");
  if (actual <= 0) return earned > 0 ? Infinity : 1;
  return earned / actual;
}
export function schedulePerformanceIndex(earned, planned) {
  assertFinite(earned, "earned");
  assertFinite(planned, "planned");
  if (planned <= 0) return 1;
  return earned / planned;
}

// Estimate to complete / estimate at completion (typical EVM forecast:
// remaining work at current CPI).
export function estimateToComplete(budgetAtCompletion, earned, cpi) {
  assertFinite(budgetAtCompletion, "budgetAtCompletion");
  assertFinite(earned, "earned");
  assertFinite(cpi, "cpi");
  const remaining = budgetAtCompletion - earned;
  if (remaining <= 0) return 0;
  if (cpi <= 0) return remaining;
  return remaining / cpi;
}
export function estimateAtCompletion(actual, etc) {
  assertFinite(actual, "actual");
  assertFinite(etc, "etc");
  return actual + etc;
}

// Weekly PPC: assignments completed / planned × 100.
// Zero planned is 0% (a week with no plan teaches nothing).
export function percentPlannedComplete(completed, planned) {
  assertFinite(completed, "completed");
  assertFinite(planned, "planned");
  if (planned <= 0) return 0;
  if (completed < 0 || completed > planned) {
    throw new Error("scheduling: completed must be 0..planned");
  }
  return (completed / planned) * 100;
}

// Manpower variance report for one day row: planned vs estimated vs actual.
// Returns the raw deltas; the UI decides how to display them.
export function manpowerVariance({ plannedHeads, actualHeads, plannedManhours, estimatedManhours, actualManhours }) {
  const out = {};
  if (plannedHeads != null && actualHeads != null) {
    assertFinite(plannedHeads, "plannedHeads");
    assertFinite(actualHeads, "actualHeads");
    out.headsDelta = actualHeads - plannedHeads;
  }
  if (plannedManhours != null && estimatedManhours != null) {
    assertFinite(plannedManhours, "plannedManhours");
    assertFinite(estimatedManhours, "estimatedManhours");
    out.estimatedDelta = estimatedManhours - plannedManhours;
  }
  if (estimatedManhours != null && actualManhours != null) {
    assertFinite(estimatedManhours, "estimatedManhours");
    assertFinite(actualManhours, "actualManhours");
    // Positive = contractor claimed more hours than the gate clocks show.
    out.timesheetVsTrackDelta = estimatedManhours - actualManhours;
  }
  if (plannedManhours != null && actualManhours != null) {
    out.actualDelta = actualManhours - plannedManhours;
  }
  return out;
}

// Weighted roll-up: disciplines (or units) each carry a weight summing to
// 1.0; the package % is the weighted sum of discipline %s.
export function weightedPercentComplete(entries) {
  if (!Array.isArray(entries)) throw new Error("scheduling: entries must be an array");
  let total = 0;
  for (const e of entries) {
    assertPct(e.pct, "entry.pct");
    assertFinite(e.weight, "entry.weight");
    if (e.weight < 0) throw new Error("scheduling: weight must be >= 0");
    total += (e.pct / 100) * e.weight;
  }
  return Math.min(100, total * 100);
}
