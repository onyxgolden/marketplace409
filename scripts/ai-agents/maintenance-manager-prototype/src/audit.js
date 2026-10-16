/**
 * audit.js — pure computation: backlog, aging, overdue, PM compliance,
 * and integrity findings, over already-charged/validated work orders and
 * PM occurrences. No I/O, no budget charges (everything consulted here
 * was already charged by the caller in src/index.js).
 *
 * Age = as_of_day - created_day (same-day = 0), using UTC civil day
 * indices (canonical.js:dayIndexOfMs) — no local/DST calendar. Bins are
 * INCLUSIVE at both named boundaries: 0-7, 8-30, 31-90, 91+.
 *
 * PM compliance "denominator poisoning" rule (the brief's named
 * acceptance case): a single invalid RELEVANT occurrence — one that is
 * itself in the denominator (due within the report window and
 * due_date<=as_of) but references an orphan asset, or a linked work
 * order that either does not exist in the register at all, or exists
 * but is itself an integrity-error record — poisons the WHOLE PM
 * compliance measure to UNVERIFIABLE. It is never silently dropped and
 * scored as a rate over the remaining, smaller denominator.
 */

import { dayIndexOfMs, rational, rToFixed } from "./canonical.js";

export const AGE_BINS = ["bin_0_7", "bin_8_30", "bin_31_90", "bin_91_plus"];

export function ageBinOf(ageDays) {
  if (ageDays <= 7) return "bin_0_7";
  if (ageDays <= 30) return "bin_8_30";
  if (ageDays <= 90) return "bin_31_90";
  return "bin_91_plus";
}

function emptyPriorityMap() {
  return { P1: 0, P2: 0, P3: 0 };
}
function emptyBinMap() {
  return { bin_0_7: 0, bin_8_30: 0, bin_31_90: 0, bin_91_plus: 0 };
}

/**
 * Classify one already-schema-valid work order against as_of/the asset
 * register. Returns {kind, ...} where kind is one of:
 *   "backlog"      — OPEN/IN_PROGRESS, created<=as_of, asset registered
 *   "completed"    — COMPLETED, created<=completed<=as_of, valid
 *   "cancelled"    — CANCELLED, valid
 *   "integrity"    — future-created, orphan asset, or invalid completion
 * A work order can match only ONE integrity reason at a time, checked in
 * a fixed order (orphan asset first, then future-created, then invalid
 * completion) so classification is deterministic.
 */
export function classifyWorkOrder(wo, { asOfMs, asOfDay, registeredAssets }) {
  if (!registeredAssets.has(wo.asset_id)) {
    return { kind: "integrity", reason: "ORPHAN_ASSET", work_order_id: wo.work_order_id };
  }
  if (wo.created_ms > asOfMs) {
    return { kind: "integrity", reason: "FUTURE_CREATED", work_order_id: wo.work_order_id };
  }
  if (wo.status === "COMPLETED") {
    if (wo.completed_ms === null || wo.completed_ms < wo.created_ms || wo.completed_ms > asOfMs) {
      return { kind: "integrity", reason: "INVALID_COMPLETION", work_order_id: wo.work_order_id };
    }
    return { kind: "completed", work_order_id: wo.work_order_id };
  }
  if (wo.status === "CANCELLED") {
    return { kind: "cancelled", work_order_id: wo.work_order_id };
  }
  // OPEN / IN_PROGRESS
  const ageDays = asOfDay - dayIndexOfMs(wo.created_ms);
  const overdue = wo.due_ms === null ? "unknown" : wo.due_ms < asOfMs ? "overdue" : "not_overdue";
  return { kind: "backlog", work_order_id: wo.work_order_id, ageDays, bin: ageBinOf(ageDays), priority: wo.priority, overdue };
}

/** Aggregate classified work orders into the backlog/overdue/cancelled
 *  report sections, plus the integrity findings list. */
export function aggregateWorkOrders(classified) {
  const backlog = { total: 0, by_priority: emptyPriorityMap(), by_bin: emptyBinMap() };
  const overdue = { total: 0, unknown_due_count: 0, by_priority: emptyPriorityMap() };
  let cancelled_count = 0;
  let completed_count = 0;
  const integrityFindings = [];

  for (const c of classified) {
    if (c.kind === "integrity") {
      integrityFindings.push({ code: c.reason, record_type: "work_order", record_id: c.work_order_id });
      continue;
    }
    if (c.kind === "cancelled") { cancelled_count += 1; continue; }
    if (c.kind === "completed") { completed_count += 1; continue; }
    // backlog
    backlog.total += 1;
    backlog.by_priority[c.priority] += 1;
    backlog.by_bin[c.bin] += 1;
    if (c.overdue === "overdue") {
      overdue.total += 1;
      overdue.by_priority[c.priority] += 1;
    } else if (c.overdue === "unknown") {
      overdue.unknown_due_count += 1;
    }
  }
  return { backlog, overdue, cancelled_count, completed_count, integrityFindings };
}

/**
 * PM compliance over already-schema-valid PM occurrences, the full set
 * of classified work orders (by id, for link resolution) and the task's
 * reporting window. Returns the pm_compliance report section plus any
 * additional integrity findings surfaced only through occurrence
 * linkage (dangling / poisoned links not otherwise visible from the
 * work-order pass alone).
 */
export function computePmCompliance(occurrences, { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById, workOrderIntegrityIds }, populationComplete) {
  const additionalFindings = [];
  const dueMembers = occurrences.filter((o) => o.due_ms >= windowStartMs && o.due_ms <= windowEndMs && o.due_ms <= asOfMs);

  if (dueMembers.length === 0) {
    return {
      section: {
        basis_state: populationComplete ? "NO_DUE_OCCURRENCES" : "UNVERIFIABLE",
        denominator: populationComplete ? 0 : null,
        numerator: populationComplete ? 0 : null,
        ratio: null,
        display_percent: null,
        early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0,
        poisoning_occurrence_ids: [],
      },
      additionalFindings,
    };
  }

  let numerator = 0, early = 0, late = 0, cancelledLink = 0, unlinked = 0;
  const poisoningIds = [];

  for (const occ of dueMembers) {
    if (!registeredAssets.has(occ.asset_id)) {
      poisoningIds.push(occ.occurrence_id);
      additionalFindings.push({ code: "ORPHAN_ASSET", record_type: "pm_occurrence", record_id: occ.occurrence_id });
      continue;
    }
    if (occ.linked_work_order_id === null) {
      unlinked += 1;
      continue;
    }
    const linked = workOrderById.get(occ.linked_work_order_id);
    if (!linked) {
      poisoningIds.push(occ.occurrence_id);
      additionalFindings.push({ code: "DANGLING_PM_LINK", record_type: "pm_occurrence", record_id: occ.occurrence_id });
      continue;
    }
    if (workOrderIntegrityIds.has(occ.linked_work_order_id)) {
      poisoningIds.push(occ.occurrence_id);
      additionalFindings.push({ code: "PM_LINK_TO_INVALID_WORK_ORDER", record_type: "pm_occurrence", record_id: occ.occurrence_id });
      continue;
    }
    if (linked.kind === "cancelled") {
      cancelledLink += 1;
      continue;
    }
    if (linked.kind !== "completed") {
      // linked order exists, is valid, but not (yet) completed — not a
      // compliance count, not a poisoning condition either; tracked with
      // "unlinked" bucket's sibling semantics are not needed per the
      // brief (only early/late/cancelled/unlinked are named), so this
      // falls through to "late" bucket only if we have no better label;
      // the brief does not name this case explicitly, so it is excluded
      // from numerator and not separately counted beyond not being a hit.
      continue;
    }
    // linked.kind === "completed": need the ORIGINAL work order's
    // completed_ms, which classifyWorkOrder's "completed" result does
    // not itself carry — resolved via the raw work order map instead.
    const completedMs = linked.completed_ms;
    if (completedMs < occ.window_start_ms) {
      early += 1;
    } else if (completedMs > occ.window_end_ms || completedMs > asOfMs) {
      late += 1;
    } else {
      numerator += 1;
    }
  }

  if (poisoningIds.length > 0) {
    return {
      section: {
        basis_state: "UNVERIFIABLE",
        denominator: null,
        numerator: null,
        ratio: null,
        display_percent: null,
        early_count: early, late_count: late, cancelled_link_count: cancelledLink, unlinked_count: unlinked,
        poisoning_occurrence_ids: poisoningIds.sort(),
      },
      additionalFindings,
    };
  }

  const denominator = dueMembers.length;
  const ratio = rational(numerator, denominator);
  return {
    section: {
      basis_state: "VERIFIED",
      denominator,
      numerator,
      ratio: { num: ratio.num.toString(), den: ratio.den.toString() },
      display_percent: `${rToFixed({ num: ratio.num * 100n, den: ratio.den }, 2)}%`,
      early_count: early, late_count: late, cancelled_link_count: cancelledLink, unlinked_count: unlinked,
      poisoning_occurrence_ids: [],
    },
    additionalFindings,
  };
}

export { dayIndexOfMs };
