/**
 * P2b-1 Scheduler planning-review evaluator (pure, deterministic).
 *
 * Input: an admitted planning snapshot (never a live DB handle, never
 * a URL, never credentials). Output: a DRAFT planning review report
 * whose every row names its evidence (snapshot spans) or an explicit
 * unavailable state. The report is review-only: no date is moved, no
 * block is edited, no assignment is created, no baseline is frozen.
 *
 * Report shape (sections, in fixed order):
 * - inventory: project/anchor/population counts + out-of-population
 *   lists (hammocks, WBS-only blocks) + tie disposition counts.
 * - components: one row per connected component with its conclusion
 *   (READY exact / QUALIFIED / NOT_MODELED), its computed activity
 *   dates (null where withheld or failed), its edges, and its
 *   critical subgraph (withheld activities/edges excluded).
 * - lookahead: the bound window [review_date, review_date+14 civil
 *   days) — declared incomplete milestones inside it, already-overdue
 *   declared incomplete milestones before it, and, for READY /
 *   QUALIFIED components, computed advisory dates beside the
 *   declared values with disagreements flagged. Declared and computed
 *   are never merged: a disagreement row carries both values.
 * - integrity: every mapping/snapshot finding as a row.
 * - review_list: deterministic review actions (verify missing
 *   calendar/duration, inspect tie/cycle, review declared-vs-
 *   computed discrepancy). No automatic repair, date commitment or
 *   crew dispatch — ever.
 * - not_modeled: the modules this lane deliberately does not model
 *   (financial measures, resource capacity/leveling, hammock
 *   resolution, WBS activities, live CPM outputs, cross-project
 *   inference).
 *
 * Status: always DRAFT (brief §10: render DRAFT / ADVISORY /
 * READ-ONLY). execution_authorized is always false. A PARTIAL
 * snapshot still yields a report, but every conclusion drawn from
 * incomplete coverage is qualified with the coverage gap — a missing
 * category never publishes as an all-clear.
 *
 * Row identity: injective by construction. A row id is
 * "sch-" + SHA-256 hex of the canonical tuple [agent, scope type,
 * scope id, section, kind, dataset, record, discriminator] — a digest
 * over the complete tuple, never a raw concatenation of caller
 * strings (the P670-005A lesson: ("a:b","c") collided with
 * ("a","b:c") under colon-join). The serializer refuses two
 * distinct rows sharing one id.
 */

import { canonicalDigest, canonicalJson, sha256Hex } from "../rental-ops/canonical.js";
import { JobRefusal } from "./jobContracts.js";
import { buildNetwork, MATH_HORIZON_DAYS } from "./sourceMappings.js";
import { addCivilDays, isCivilDate, utcCivilDate } from "./fieldMappings.js";

export const EVALUATOR_VERSION = "planning-scheduler-evaluator@1";
export const LOOKAHEAD_DAYS = 14;

export function schedulerRowId(tuple) {
  return `sch-${sha256Hex(canonicalJson(tuple))}`;
}

function rowIdFor({ agent, scope, section, kind, dataset, record, discriminator = "" }) {
  return schedulerRowId([agent, scope.type, scope.id, section, kind, dataset, record, discriminator]);
}

/** Declared incomplete: a block whose source percent_complete is a number < 100. Null/unknown is NOT incomplete — it is unknown. */
function declaredIncomplete(block) {
  return typeof block.percent_complete === "number" && block.percent_complete < 100;
}

export function evaluateSchedulerSnapshot(snapshot, { horizonDays = MATH_HORIZON_DAYS } = {}) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.records) {
    throw new JobRefusal("BAD_SNAPSHOT", "scheduler evaluation requires an admitted snapshot with records");
  }
  const scope = snapshot.project_scope_ref ?? { type: "scheduling-project", id: "unknown" };
  const agent = "scheduler";
  const reviewDate = utcCivilDate(snapshot.as_of);
  const lookaheadEnd = addCivilDays(reviewDate, LOOKAHEAD_DAYS);

  const network = buildNetwork(snapshot, { horizonDays });
  const { project, anchor, components, inventory, findings } = network;

  const blocksById = new Map((snapshot.records.schedule_blocks ?? []).map((b) => [b.block_ref, b]));

  // --- integrity rows (every finding) ---
  const integrityRows = findings.map((f) => ({
    row_id: rowIdFor({ agent, scope, section: "integrity", kind: f.kind, dataset: f.dataset, record: f.record_ref }),
    kind: f.kind, dataset: f.dataset, record_ref: f.record_ref, detail: f.detail ?? "",
    evidence: f.evidence ?? [{ dataset: f.dataset, record_ref: f.record_ref }],
  }));

  // --- component rows ---
  const componentRows = components.map((c) => {
    const activityRows = (c.activities ?? []).map((a) => {
      const block = blocksById.get(a.id) ?? {};
      return {
        row_id: rowIdFor({ agent, scope, section: "components", kind: "activity", dataset: "schedule_blocks", record: a.id, discriminator: c.component_id }),
        component_id: c.component_id,
        block_ref: a.id, task_code: block.task_code ?? null,
        declared_start: block.start_date ?? null,
        declared_percent_complete: block.percent_complete ?? null,
        computed_start: a.civil_start ?? null,
        computed_finish_boundary: a.civil_finish_boundary ?? null,
        es_tick: a.es ?? null, ef_tick: a.ef ?? null, ls_tick: a.ls ?? null, lf_tick: a.lf ?? null,
        total_float: a.total_float ?? null, critical: a.critical ?? null,
        withheld: a.withheld ?? null,
        evidence: [{ dataset: "schedule_blocks", record_ref: a.id }],
      };
    });
    const edgeRows = (c.edges ?? []).map((e) => ({
      row_id: rowIdFor({ agent, scope, section: "components", kind: "edge", dataset: "schedule_dependencies", record: e.id, discriminator: c.component_id }),
      component_id: c.component_id, tie_ref: e.id,
      predecessor: e.predecessor, successor: e.successor, type: e.type,
      lag_workdays: e.lag_workdays, weight: e.weight, tight: e.tight, critical: e.critical,
      withheld: e.withheld ?? null,
      evidence: [{ dataset: "schedule_dependencies", record_ref: e.id }],
    }));
    return {
      row_id: rowIdFor({ agent, scope, section: "components", kind: "component", dataset: "schedule_projects", record: c.component_id }),
      component_id: c.component_id,
      activity_ids: c.activity_ids,
      calendar_ref: c.calendar_ref,
      anchor_date: c.anchor_date,
      conclusion: c.conclusion,
      prototype_status: c.prototype_status,
      prototype_reason: c.prototype_reason ?? null,
      prototype_detail: c.prototype_detail ?? null,
      working_days_count: c.working_days_count,
      qualifications: c.qualifications ?? [],
      withheld: c.withheld ?? {},
      activities: activityRows,
      edges: edgeRows,
      critical_subgraph: c.critical_subgraph,
      evidence: c.activity_ids.map((id) => ({ dataset: "schedule_blocks", record_ref: id })),
    };
  });

  // --- lookahead rows ---
  // Declared milestones: Gantt milestones (lane set, non-hammock)
  // with a declared start_date. Incomplete = percent_complete < 100
  // (a number); unknown percent is reported as unknown, never as
  // incomplete and never as complete.
  const computedByBlock = new Map();
  for (const comp of componentRows) {
    for (const a of comp.activities) computedByBlock.set(a.block_ref, { ...a, component_id: comp.component_id, conclusion: comp.conclusion });
  }
  const lookaheadRows = [];
  for (const b of snapshot.records.schedule_blocks ?? []) {
    if (b.block_type !== "milestone" || b.lane_ref === undefined || b.lane_ref === null) continue;
    if (!isCivilDate(b.start_date)) continue;
    const incomplete = declaredIncomplete(b);
    const unknown = typeof b.percent_complete !== "number";
    const inWindow = b.start_date >= reviewDate && b.start_date < lookaheadEnd;
    const overdue = b.start_date < reviewDate;
    if (!inWindow && !(overdue && incomplete)) continue;
    const computed = computedByBlock.get(b.block_ref);
    const computedStart = computed?.computed_start ?? null;
    const disagreement = computed && computedStart !== null && computedStart !== b.start_date
      ? `declared start ${b.start_date} differs from computed advisory start ${computedStart}`
      : null;
    lookaheadRows.push({
      row_id: rowIdFor({ agent, scope, section: "lookahead", kind: overdue && !inWindow ? "overdue-milestone" : "lookahead-milestone", dataset: "schedule_blocks", record: b.block_ref }),
      block_ref: b.block_ref, task_code: b.task_code ?? null,
      declared_start: b.start_date,
      declared_state: incomplete ? "INCOMPLETE" : unknown ? "UNKNOWN" : "COMPLETE",
      declared_percent_complete: b.percent_complete ?? null,
      computed_start: computedStart,
      computed_component: computed?.component_id ?? null,
      computed_conclusion: computed?.conclusion ?? null,
      bucket: overdue && !inWindow ? "OVERDUE" : "LOOKAHEAD",
      disagreement,
      evidence: [{ dataset: "schedule_blocks", record_ref: b.block_ref }],
    });
  }
  lookaheadRows.sort((a, b) => (a.declared_start < b.declared_start ? -1 : a.declared_start > b.declared_start ? 1 : a.block_ref < b.block_ref ? -1 : 1));

  // --- review list (deterministic, from findings + lookahead) ---
  const reviewRows = [];
  const pushReview = (kind, recordRef, dataset, action, detail) => {
    reviewRows.push({
      row_id: rowIdFor({ agent, scope, section: "review_list", kind, dataset, record: recordRef, discriminator: action }),
      kind, record_ref: recordRef, dataset, action, detail,
      evidence: [{ dataset, record_ref: recordRef }],
    });
  };
  for (const f of findings) {
    if (f.kind === "MISSING_CALENDAR" || f.kind === "MISSING_DURATION") {
      pushReview("VERIFY_MISSING", f.record_ref, f.dataset, "verify-missing",
        `Verify the missing ${f.kind === "MISSING_CALENDAR" ? "calendar" : "duration"} for this record; no default is assumed`);
    } else if (f.kind === "TIE_DANGLING" || f.kind === "TIE_CROSS_SCOPE_WBS" || f.kind === "NONZERO_LAG_NOT_MODELED" || f.kind === "HAMMOCK_TIE") {
      pushReview("INSPECT_TIE", f.record_ref, f.dataset, "inspect-tie",
        `Inspect this tie: ${f.detail}`);
    } else if (f.kind === "MIXED_CALENDARS" || f.kind === "UNSUPPORTED_CONSTRAINT" || f.kind === "UNSUPPORTED_CONSTRAINT_HORIZON") {
      pushReview("REVIEW_CONSTRAINT", f.record_ref, f.dataset, "review-constraint",
        `Review this constraint/calendar limitation: ${f.detail}`);
    }
  }
  for (const r of lookaheadRows) {
    if (r.disagreement) {
      pushReview("REVIEW_DISCREPANCY", r.block_ref, "schedule_blocks", "review-discrepancy", r.disagreement);
    }
  }
  for (const c of components) {
    if (c.prototype_status === "CYCLE_DETECTED") {
      pushReview("INSPECT_CYCLE", c.component_id, "schedule_dependencies", "inspect-cycle",
        `Inspect the cycle blocking component ${c.component_id}: ${(c.prototype_detail?.cycle_path ?? []).join(" → ")}`);
    }
  }

  const diagnostics = [];
  if (snapshot.consistency === "PARTIAL") {
    diagnostics.push({ code: "SNAPSHOT_PARTIAL", reason: "the snapshot is PARTIAL; conclusions drawn from incomplete coverage are qualified, never all-clear" });
  }
  for (const g of snapshot.coverage_gaps ?? []) {
    diagnostics.push({ code: g.code, dataset: g.dataset, reason: g.detail ?? "" });
  }
  for (const e of snapshot.collection_errors ?? []) {
    diagnostics.push({ code: e.code, dataset: e.dataset, reason: "collection error for this dataset" });
  }
  for (const cf of snapshot.conflicts ?? []) {
    diagnostics.push({ code: cf.code, dataset: cf.dataset, record_ref: cf.record_ref, reason: "conflicting rows share one record ref; the first admitted row wins and the snapshot is PARTIAL" });
  }

  const report = {
    schema_version: "planning-scheduler-report@1",
    agent,
    job_kind: "scheduler-planning-review",
    job_version: 1,
    owner_ref: snapshot.owner_ref,
    project_scope_ref: scope,
    window: { name: "planning-lookahead-14-civil-days" },
    as_of: snapshot.as_of,
    as_of_date: reviewDate,
    as_of_timezone: "UTC",
    review_date: reviewDate,
    lookahead_window: { start: reviewDate, end_exclusive: lookaheadEnd, days: LOOKAHEAD_DAYS },
    status: "DRAFT",
    snapshot_digest: snapshot.digest,
    snapshot_consistency: snapshot.consistency,
    anchor_date: anchor,
    project_ref: project?.project_ref ?? null,
    sections: {
      inventory: {
        ...inventory,
        evidence: [],
      },
      components: { rows: componentRows },
      lookahead: { rows: lookaheadRows },
      integrity: { rows: integrityRows },
      review_list: { rows: reviewRows },
      not_modeled: {
        modules: [
          "financial measures (PV/EV/AC/CPI/SPI/EAC, contingency, costs, hours)",
          "resource capacity, labor availability, assignments and leveling",
          "hammock date resolution (anchor-derived dates in the app)",
          "WBS-only activities (outside the CPM population)",
          "live CPM engine outputs stored on schedule_blocks (recomputed, never read)",
          "cross-project inference (no mapping registered)",
          "nonzero-lag tie math (calendar-day lag has no constant working-day equivalent)",
          "mixed-calendar component math (prototype takes one calendar per component)",
          "project end_date as a deadline (a generic end date is not a mandatory deadline)",
        ],
      },
    },
    diagnostics,
    execution_authorized: false,
  };
  return report;
}
