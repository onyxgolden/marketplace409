import { ESCALATION_POLICIES } from "./jobContracts.js";
import {
  WORK_ORDER_STATUS_MAP,
  civilDayDiff, isCivilDate, mapStatus,
} from "./fieldMappings.js";

export const EVALUATOR_VERSION = "maintenance-manager-evaluator@1";

/**
 * Actual source priority enum, confirmed against the reviewed rental
 * read models (TenantPortalQueryService reads
 * rental_maintenance_requests.priority; buildRentalDashboardSummary's
 * MAINTENANCE_PRIORITY_WEIGHT keys urgent/emergency/high/normal/
 * medium/low). The Maintenance prototype's P1/P2/P3 is the
 * prototype's synthetic convention, not the source enum. Absent or
 * unrecognized priority is "unclassified" — never a defaulted
 * severity, never P3.
 */
export const WORK_ORDER_PRIORITIES = Object.freeze([
  "urgent", "emergency", "high", "normal", "medium", "low",
]);
const PRIORITY_WEIGHT = Object.freeze({
  urgent: 3, emergency: 3, high: 2, normal: 1, medium: 1, low: 0, unclassified: -1,
});

export function normalizeWorkOrderPriority(raw) {
  if (raw === undefined || raw === null) return { priority: "unclassified", recognized: false, present: false };
  if (typeof raw !== "string") return { priority: "unclassified", recognized: false, present: true };
  const v = raw.toLowerCase();
  if (WORK_ORDER_PRIORITIES.includes(v)) return { priority: v, recognized: true, present: true };
  return { priority: "unclassified", recognized: false, present: true };
}

/** Prototype's civil-day bins, inclusive at both named boundaries. */
export function ageBinOf(ageDays) {
  if (ageDays <= 7) return "bin_0_7";
  if (ageDays <= 30) return "bin_8_30";
  if (ageDays <= 90) return "bin_31_90";
  return "bin_91_plus";
}
export const AGE_BINS = Object.freeze(["bin_0_7", "bin_8_30", "bin_31_90", "bin_91_plus", "unknown"]);

/**
 * Maintenance Manager backlog review over an admitted snapshot.
 *
 * Pure and deterministic: same snapshot bytes in -> same report out.
 * Semantics follow the P2a brief's P2a-2 section and the reviewed
 * work-order report projection (buildWorkOrdersReport.js:
 * OPEN_STATUSES = draft/assigned/scheduled/in_progress):
 *
 * - Backlog = OPEN + IN_PROGRESS work orders only. Unknown statuses
 *   are explicit integrity rows — never counted as closed, never
 *   silently treated as open.
 * - Aging uses the work-order CREATION date (civil-day difference to
 *   the Chicago as_of_date), never request submission or scheduled
 *   start. A missing/invalid created_date makes aging UNVERIFIABLE
 *   for that row (named integrity row; the row stays in the backlog
 *   with age unknown, never silently dropped).
 * - Due is explicit only: due_date < as_of_date is OVERDUE, due today
 *   is not overdue, missing due dates are UNKNOWN. scheduled_end is
 *   not admitted and is never treated as a due date.
 * - Priority follows the actual source enum; absent/unrecognized
 *   priority is "unclassified", never a defaulted severity.
 * - PM compliance is NOT_MODELED in this wiring slice — not 0%, not
 *   100%, not an empty register. No assets are created from units and
 *   no occurrences are generated.
 *
 * Output is a bounded backlog/aging/explicit-overdue review with
 * unknown counts, integrity gaps and source-linked review rows. No
 * dispatch, scheduling, purchases, work closure, reliability
 * prediction or emergency response guarantee. Nothing is seeded:
 * flags derive only from admitted fields.
 */
export function evaluateMaintenanceManagerSnapshot(snapshot, { policies = ESCALATION_POLICIES } = {}) {
  void policies; // Review-only job: no escalation touchpoints; kept for the shared evaluator signature.
  const asOfDate = snapshot.as_of_date;
  const rec = snapshot.records;
  const diagnostics = [];
  const integrity = [];
  const pushIntegrity = (kind, dataset, record_ref, extra = {}) =>
    integrity.push({ row_id: `int:${kind}:${record_ref}`, kind, dataset, record_ref, ...extra });

  const unitsByRef = new Map(rec.units.map((u) => [u.unit_ref, u]));
  const propertiesByRef = new Map(rec.properties.map((p) => [p.property_ref, p]));
  for (const c of snapshot.conflicts ?? []) {
    pushIntegrity("DUPLICATE_CONFLICT", c.dataset, c.record_ref);
  }
  for (const g of snapshot.coverage_gaps ?? []) {
    pushIntegrity(g.code, g.dataset, "coverage", g.detail ? { detail: g.detail } : {});
  }

  const span = (dataset, ref) => {
    const s = snapshot.evidence?.[dataset]?.[ref];
    return s ? { dataset, record_ref: ref, sha256: s.sha256 } : null;
  };

  // ---- work-order admission: linkage + status integrity -----------
  const backlog = [];
  let completedCount = 0;
  let cancelledCount = 0;
  for (const wo of rec.work_orders) {
    const ref = wo.work_order_ref;
    if (wo.unit_ref !== undefined && wo.unit_ref !== null && !unitsByRef.has(wo.unit_ref)) {
      pushIntegrity("WO_UNIT_DANGLING", "work_orders", ref, { unit_ref: wo.unit_ref });
    }
    if (wo.property_ref !== undefined && wo.property_ref !== null && !propertiesByRef.has(wo.property_ref)) {
      pushIntegrity("WO_PROPERTY_DANGLING", "work_orders", ref, { property_ref: wo.property_ref });
    }
    const mapped = mapStatus(WORK_ORDER_STATUS_MAP, wo.status);
    if (mapped === "UNKNOWN") {
      pushIntegrity("WO_STATUS_UNSUPPORTED", "work_orders", ref, { source_status: wo.status ?? null });
      continue;
    }
    if (mapped === "COMPLETED") { completedCount += 1; continue; }
    if (mapped === "CANCELLED") { cancelledCount += 1; continue; }

    // ---- aging: creation date only --------------------------------
    let ageDays = null;
    let ageBin = "unknown";
    let agingVerifiable = true;
    if (wo.created_date === undefined || wo.created_date === null) {
      pushIntegrity("WO_CREATED_DATE_MISSING", "work_orders", ref);
      agingVerifiable = false;
    } else if (!isCivilDate(wo.created_date)) {
      pushIntegrity("WO_CREATED_DATE_INVALID", "work_orders", ref, { created_date: wo.created_date });
      agingVerifiable = false;
    } else {
      ageDays = civilDayDiff(wo.created_date, asOfDate);
      ageBin = ageBinOf(ageDays);
    }

    // ---- priority: actual source enum, fail-closed -----------------
    const pr = normalizeWorkOrderPriority(wo.priority);
    if (pr.present && !pr.recognized) {
      pushIntegrity("PRIORITY_UNRECOGNIZED", "work_orders", ref, { priority: wo.priority });
    }

    // ---- due: explicit only; due today is not overdue -------------
    let dueState = "UNKNOWN";
    if (wo.due_date !== undefined && wo.due_date !== null) {
      if (!isCivilDate(wo.due_date)) {
        pushIntegrity("WO_DUE_DATE_INVALID", "work_orders", ref, { due_date: wo.due_date });
      } else if (wo.due_date < asOfDate) {
        dueState = "OVERDUE";
      } else if (wo.due_date === asOfDate) {
        dueState = "DUE_TODAY";
      } else {
        dueState = "FUTURE";
      }
    }

    // ---- completed_date: format only --------------------------------
    if (wo.completed_date !== undefined && wo.completed_date !== null && !isCivilDate(wo.completed_date)) {
      pushIntegrity("WO_COMPLETED_DATE_INVALID", "work_orders", ref, { completed_date: wo.completed_date });
    }

    const flags = [];
    if (dueState === "OVERDUE") flags.push("OVERDUE");
    if (dueState === "DUE_TODAY") flags.push("DUE_TODAY");
    if (dueState === "UNKNOWN") flags.push("DUE_UNKNOWN");
    if (!agingVerifiable) flags.push("AGING_UNVERIFIABLE");
    if (!pr.recognized) flags.push("PRIORITY_UNCLASSIFIED");

    backlog.push({
      row_id: `wo:${ref}`,
      kind: "BACKLOG_ITEM",
      work_order_ref: ref,
      request_ref: wo.request_ref ?? null,
      unit_ref: wo.unit_ref ?? null,
      property_ref: wo.property_ref ?? null,
      status: mapped,
      source_status: wo.status ?? null,
      created_date: wo.created_date ?? null,
      age_days: ageDays,
      age_bin: ageBin,
      aging_verifiable: agingVerifiable,
      priority: pr.priority,
      priority_source: typeof wo.priority === "string" ? wo.priority : null,
      due_date: wo.due_date ?? null,
      due_state: dueState,
      completed_date: wo.completed_date ?? null,
      flags,
      evidence: [span("work_orders", ref), span("units", wo.unit_ref)].filter(Boolean),
    });
  }

  // Review order is deterministic: oldest first (unknown age last),
  // then priority weight, then ref. This is a display order, not a
  // severity claim — unclassified priority sorts last.
  backlog.sort((a, b) => {
    const aa = a.age_days === null ? -1 : a.age_days;
    const bb = b.age_days === null ? -1 : b.age_days;
    if (aa !== bb) return bb - aa;
    const pa = PRIORITY_WEIGHT[a.priority] ?? -1;
    const pb = PRIORITY_WEIGHT[b.priority] ?? -1;
    if (pa !== pb) return pb - pa;
    return a.work_order_ref < b.work_order_ref ? -1 : 1;
  });

  // ---- aggregates: counts only, unknowns named, never "all clear" --
  const byBin = { bin_0_7: 0, bin_8_30: 0, bin_31_90: 0, bin_91_plus: 0, unknown: 0 };
  const byPriority = { urgent: 0, emergency: 0, high: 0, normal: 0, medium: 0, low: 0, unclassified: 0 };
  const byStatus = { OPEN: 0, IN_PROGRESS: 0 };
  let unknownAgeCount = 0;
  for (const row of backlog) {
    byBin[row.age_bin] += 1;
    byPriority[row.priority] += 1;
    byStatus[row.status] += 1;
    if (!row.aging_verifiable) unknownAgeCount += 1;
  }
  const overdueRows = backlog.filter((r) => r.due_state === "OVERDUE");
  const unknownDueCount = backlog.filter((r) => r.due_state === "UNKNOWN").length;
  const overdueByPriority = { urgent: 0, emergency: 0, high: 0, normal: 0, medium: 0, low: 0, unclassified: 0 };
  for (const row of overdueRows) overdueByPriority[row.priority] += 1;

  integrity.sort((a, b) => (a.kind !== b.kind
    ? (a.kind < b.kind ? -1 : 1)
    : (a.record_ref < b.record_ref ? -1 : a.record_ref > b.record_ref ? 1 : 0)));
  for (const row of integrity) {
    row.evidence = [span(row.dataset, row.record_ref)].filter(Boolean);
  }

  // ---- recommendations: review-only, never seeded -------------------
  const recommendations = [];
  const escalations = [];
  const urgencyFor = (row) => {
    if (row.due_state === "OVERDUE" && (row.priority === "urgent" || row.priority === "emergency")) return "high";
    if (row.due_state === "OVERDUE") return "elevated";
    return "routine";
  };
  for (const row of backlog) {
    const ageText = row.aging_verifiable
      ? `${row.age_days} days old (bin ${row.age_bin})`
      : "age UNVERIFIABLE (creation date missing or invalid)";
    const dueText = row.due_state === "OVERDUE" ? `explicitly overdue since ${row.due_date}`
      : row.due_state === "DUE_TODAY" ? "due today (not overdue)"
      : row.due_state === "FUTURE" ? `due ${row.due_date}`
      : "due date unknown";
    recommendations.push({
      row_id: row.row_id,
      action_class: "REVIEW_BACKLOG_ITEM",
      text: `Work order ${row.work_order_ref} (${row.status}, priority ${row.priority}): ${ageText}; ${dueText} — human review; no dispatch, scheduling, purchase, closure or emergency action is authorized.`,
      status: "PROPOSED",
      touchpoints: [],
      execution_authorized: false,
      urgency: urgencyFor(row),
    });
  }
  for (const row of integrity) {
    recommendations.push({
      row_id: row.row_id,
      action_class: "REVIEW_INTEGRITY",
      text: `Source integrity issue ${row.kind} on ${row.dataset} record ${row.record_ref} — data-quality review; no domain conclusion is drawn from this record.`,
      status: "PROPOSED",
      touchpoints: [],
      execution_authorized: false,
    });
  }

  const blockedCount = recommendations.filter((r) => r.status === "BLOCKED").length;
  const status = blockedCount > 0 ? "BLOCKED" : (snapshot.consistency === "PARTIAL" ? "PARTIAL" : "PROPOSED");
  if (snapshot.consistency === "PARTIAL") {
    diagnostics.push({ code: "SNAPSHOT_PARTIAL", reason: "snapshot coverage is incomplete or mixed-revision; the review covers admitted records only" });
  }
  if (snapshot.stale) diagnostics.push({ code: "SNAPSHOT_STALE", reason: "collection finished more than 15 minutes before as_of" });
  diagnostics.push({
    code: "PM_COMPLIANCE_NOT_MODELED",
    reason: "no authoritative asset/PM-occurrence population was established by the inspected work-order report; PM compliance is NOT_MODELED in this wiring slice (not 0%, not 100%, not an empty register). Enabling that live metric is separate scope.",
  });

  return {
    report_schema: "rental-ops-report@1",
    evaluator_version: EVALUATOR_VERSION,
    agent: "maintenance-manager",
    kind: "maintenance-manager-backlog-review",
    owner_ref: snapshot.owner_ref,
    portfolio_ref: snapshot.portfolio_ref,
    as_of: snapshot.as_of,
    as_of_date: asOfDate,
    as_of_timezone: snapshot.as_of_timezone,
    window: { name: "maintenance-backlog-open" },
    snapshot_digest: snapshot.digest,
    snapshot_consistency: snapshot.consistency,
    coverage: snapshot.datasets,
    status,
    sections: {
      backlog: {
        rows: backlog,
        count: backlog.length,
        by_bin: byBin,
        by_priority: byPriority,
        by_status: byStatus,
        closed_counts: { completed: completedCount, cancelled: cancelledCount },
        unknown_age_count: unknownAgeCount,
      },
      overdue: {
        rows: overdueRows,
        count: overdueRows.length,
        unknown_due_count: unknownDueCount,
        by_priority: overdueByPriority,
      },
      integrity: { rows: integrity, count: integrity.length },
      pm_compliance: "NOT_MODELED",
    },
    recommendations,
    escalations,
    exclusions: (snapshot.collection_errors ?? []).map((e) => ({ dataset: e.dataset, code: e.code })),
    diagnostics,
    no_exceptions_found: status === "PROPOSED" && backlog.length === 0 && integrity.length === 0,
    execution_authorized: false,
  };
}
