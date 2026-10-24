import { Budget } from "./budgets.js";
import { buildSnapshot } from "./snapshotBuilder.js";
import { MM_DATASETS } from "./fieldMappings.js";
import {
  EVALUATOR_VERSION, ageBinOf, evaluateMaintenanceManagerSnapshot, normalizeWorkOrderPriority,
} from "./maintenanceManagerJob.js";
import { makeAdapter, fixedClock } from "./snapshotBuilder.test.js";

const REQUEST = {
  principal_ref: "host:workbench-operator", owner_ref: "owner-a", portfolio_ref: "portfolio-a",
  job_kind: "maintenance-manager-backlog-review", job_version: 1,
  as_of: "2026-10-22T14:00:00.000Z", window: { name: "maintenance-backlog-open" },
  snapshot_request_id: "snap-mm-1",
};

async function run(data, opts = {}) {
  // Mirrors the production path: executeWorker collects MM_DATASETS
  // for this job kind, not the Property Manager's DATASETS default.
  const snap = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(data), budget: new Budget(), clock: fixedClock(), datasets: MM_DATASETS });
  return { snap, report: evaluateMaintenanceManagerSnapshot(snap, opts) };
}
const shell = (over = {}) => ({
  properties: [{ property_ref: "prop-1", owner_ref: "owner-a" }],
  units: [{ unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "occupied" }],
  leases: [], memberships: [], charges: [], schedules: [], work_orders: [], ...over,
});
const wo = (over = {}) => ({
  work_order_ref: "wo-1", request_ref: "req-1", unit_ref: "unit-1", property_ref: "prop-1",
  owner_ref: "owner-a", status: "assigned", created_date: "2026-10-15", priority: "high",
  due_date: null, completed_date: null, ...over,
});

describe("domain oracle — aging boundaries (as_of_date 2026-10-22)", () => {
  it.each([
    ["2026-10-22", 0, "bin_0_7"], ["2026-10-15", 7, "bin_0_7"],
    ["2026-10-14", 8, "bin_8_30"], ["2026-09-22", 30, "bin_8_30"],
    ["2026-09-21", 31, "bin_31_90"], ["2026-07-24", 90, "bin_31_90"],
    ["2026-07-23", 91, "bin_91_plus"],
  ])("created %s -> age %d, bin %s", async (created, age, bin) => {
    const { report } = await run(shell({ work_orders: [wo({ created_date: created })] }));
    const rows = report.sections.backlog.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].age_days).toBe(age);
    expect(rows[0].age_bin).toBe(bin);
    expect(rows[0].aging_verifiable).toBe(true);
  });

  it("missing/invalid created_date makes aging UNVERIFIABLE but keeps the row in the backlog", async () => {
    const { report } = await run(shell({
      work_orders: [wo({ work_order_ref: "wo-nodate", created_date: undefined }), wo({ work_order_ref: "wo-baddate", created_date: "not-a-date" })],
    }));
    expect(report.sections.backlog.rows).toHaveLength(2);
    for (const row of report.sections.backlog.rows) {
      expect(row.age_days).toBeNull();
      expect(row.age_bin).toBe("unknown");
      expect(row.aging_verifiable).toBe(false);
      expect(row.flags).toContain("AGING_UNVERIFIABLE");
    }
    const kinds = report.sections.integrity.rows.map((r) => r.kind);
    expect(kinds).toContain("WO_CREATED_DATE_MISSING");
    expect(kinds).toContain("WO_CREATED_DATE_INVALID");
    expect(report.sections.backlog.unknown_age_count).toBe(2);
  });
});

describe("domain oracle — status variants", () => {
  it.each([
    ["draft", "OPEN", true], ["assigned", "OPEN", true], ["scheduled", "OPEN", true],
    ["in_progress", "IN_PROGRESS", true], ["completed", "COMPLETED", false], ["cancelled", "CANCELLED", false],
  ])("source status %s -> %s, in backlog=%s", async (source, mapped, inBacklog) => {
    const { report } = await run(shell({ work_orders: [wo({ status: source })] }));
    expect(report.sections.backlog.rows.length).toBe(inBacklog ? 1 : 0);
    if (inBacklog) expect(report.sections.backlog.rows[0].status).toBe(mapped);
  });

  it("unknown statuses are explicit integrity rows, never counted as closed or open", async () => {
    const { report } = await run(shell({ work_orders: [wo({ work_order_ref: "wo-x", status: "teleported" })] }));
    expect(report.sections.backlog.rows).toHaveLength(0);
    expect(report.sections.integrity.rows.map((r) => r.kind)).toContain("WO_STATUS_UNSUPPORTED");
    expect(report.sections.backlog.closed_counts).toEqual({ completed: 0, cancelled: 0 });
  });

  it("completed/cancelled are counted as closed, not backlog", async () => {
    const { report } = await run(shell({
      work_orders: [wo({ work_order_ref: "wo-c", status: "completed" }), wo({ work_order_ref: "wo-x", status: "cancelled" })],
    }));
    expect(report.sections.backlog.rows).toHaveLength(0);
    expect(report.sections.backlog.closed_counts).toEqual({ completed: 1, cancelled: 1 });
    expect(report.no_exceptions_found).toBe(true);
  });
});

describe("domain oracle — due yesterday / today / unknown", () => {
  it("due yesterday is OVERDUE, due today is not overdue, missing due is UNKNOWN", async () => {
    const { report } = await run(shell({
      work_orders: [
        wo({ work_order_ref: "wo-over", due_date: "2026-10-21" }),
        wo({ work_order_ref: "wo-today", due_date: "2026-10-22" }),
        wo({ work_order_ref: "wo-none", due_date: null }),
        wo({ work_order_ref: "wo-future", due_date: "2026-11-01" }),
      ],
    }));
    const byRef = Object.fromEntries(report.sections.backlog.rows.map((r) => [r.work_order_ref, r]));
    expect(byRef["wo-over"].due_state).toBe("OVERDUE");
    expect(byRef["wo-over"].flags).toContain("OVERDUE");
    expect(byRef["wo-today"].due_state).toBe("DUE_TODAY");
    expect(byRef["wo-today"].flags).toContain("DUE_TODAY");
    expect(byRef["wo-today"].flags).not.toContain("OVERDUE");
    expect(byRef["wo-none"].due_state).toBe("UNKNOWN");
    expect(byRef["wo-future"].due_state).toBe("FUTURE");
    expect(report.sections.overdue.rows.map((r) => r.work_order_ref)).toEqual(["wo-over"]);
    expect(report.sections.overdue.unknown_due_count).toBe(1);
  });

  it("invalid due_date is an integrity row and stays UNKNOWN", async () => {
    const { report } = await run(shell({ work_orders: [wo({ due_date: "tomorrow" })] }));
    expect(report.sections.backlog.rows[0].due_state).toBe("UNKNOWN");
    expect(report.sections.integrity.rows.map((r) => r.kind)).toContain("WO_DUE_DATE_INVALID");
  });
});

describe("domain oracle — priority normalization", () => {
  it.each([["urgent", "urgent"], ["EMERGENCY", "emergency"], ["High", "high"], ["normal", "normal"], ["medium", "medium"], ["low", "low"]])(
    "source priority %s normalizes to %s", (raw, expected) => {
      expect(normalizeWorkOrderPriority(raw).priority).toBe(expected);
    });

  it("absent priority is unclassified without an integrity row; unrecognized priority is unclassified WITH one", async () => {
    const { report } = await run(shell({
      work_orders: [wo({ work_order_ref: "wo-absent", priority: undefined }), wo({ work_order_ref: "wo-weird", priority: "P1" })],
    }));
    const byRef = Object.fromEntries(report.sections.backlog.rows.map((r) => [r.work_order_ref, r]));
    expect(byRef["wo-absent"].priority).toBe("unclassified");
    expect(byRef["wo-weird"].priority).toBe("unclassified");
    const kinds = report.sections.integrity.rows.map((r) => r.kind);
    expect(kinds).toContain("PRIORITY_UNRECOGNIZED");
    expect(kinds.filter((k) => k === "PRIORITY_UNRECOGNIZED")).toHaveLength(1);
  });
});

describe("domain oracle — linkage integrity and orphan request linkage", () => {
  it("dangling unit/property linkages are integrity rows; the row stays in the backlog", async () => {
    const { report } = await run(shell({
      work_orders: [wo({ work_order_ref: "wo-orphan", request_ref: "req-orphan", unit_ref: "unit-ghost", property_ref: "prop-ghost" })],
    }));
    expect(report.sections.backlog.rows).toHaveLength(1);
    const kinds = report.sections.integrity.rows.map((r) => r.kind);
    expect(kinds).toContain("WO_UNIT_DANGLING");
    expect(kinds).toContain("WO_PROPERTY_DANGLING");
    expect(report.sections.backlog.rows[0].request_ref).toBe("req-orphan");
  });
});

describe("domain oracle — PM compliance is explicitly NOT_MODELED", () => {
  it("never reports a compliance rate, even over an empty register", async () => {
    const { report } = await run(shell());
    expect(report.sections.pm_compliance).toBe("NOT_MODELED");
    expect(JSON.stringify(report)).not.toMatch(/"pm_compliance":\s*\{/);
    expect(report.diagnostics.map((d) => d.code)).toContain("PM_COMPLIANCE_NOT_MODELED");
  });
});

async function runAsOf(data, { as_of, clockIso }) {
  const request = { ...REQUEST, as_of };
  const snap = await buildSnapshot({ request, adapter: makeAdapter(data), budget: new Budget(), clock: fixedClock(clockIso), datasets: MM_DATASETS });
  return { snap, report: evaluateMaintenanceManagerSnapshot(snap) };
}

describe("P670-001 — MM aging/due use the UTC civil-day clock, not the shared Chicago date", () => {
  // Each vector sits where the UTC and America/Chicago civil dates
  // DIFFER, so the frozen age/bin is only reachable under the UTC
  // clock: under the old shared Chicago clock every row here aged
  // one day less (age 7, bin_0_7).
  it.each([
    // ChatGPT's executed UTC_DAY_BOUNDARY probe: 02:00Z is still
    // 2026-10-22 in Chicago, already 2026-10-23 in UTC.
    ["2026-10-23T02:00:00.000Z", "2026-10-23T01:55:00.000Z", "2026-10-15", "2026-10-23"],
    // Chicago-midnight boundary: 04:30Z is 23:30 CDT the day before.
    ["2026-10-23T04:30:00.000Z", "2026-10-23T04:25:00.000Z", "2026-10-15", "2026-10-23"],
    // DST fall-back boundary: 2026-11-02T05:30Z is 2026-11-01 23:30
    // CST (after the Nov 1 fall-back); UTC date is 2026-11-02.
    ["2026-11-02T05:30:00.000Z", "2026-11-02T05:25:00.000Z", "2026-10-25", "2026-11-02"],
    // DST spring-forward boundary: 2026-03-09T04:30Z is 2026-03-08
    // 23:30 CDT (after the Mar 8 spring-forward); UTC is 2026-03-09.
    ["2026-03-09T04:30:00.000Z", "2026-03-09T04:25:00.000Z", "2026-03-01", "2026-03-09"],
  ])("as_of %s (clock %s), created %s -> age 8, bin_8_30, evaluation date %s", async (asOf, clockIso, created, evalDate) => {
    const { report } = await runAsOf(shell({ work_orders: [wo({ created_date: created })] }), { as_of: asOf, clockIso });
    const row = report.sections.backlog.rows[0];
    expect(row.age_days).toBe(8);
    expect(row.age_bin).toBe("bin_8_30");
    expect(row.aging_verifiable).toBe(true);
    expect(report.as_of_date).toBe(evalDate);
    expect(report.as_of_timezone).toBe("UTC");
  });

  it("the two calendars are separated: the snapshot keeps its Chicago date while the MM report evaluates on UTC", async () => {
    const { snap, report } = await runAsOf(shell({ work_orders: [wo({ created_date: "2026-10-15" })] }), {
      as_of: "2026-10-23T02:00:00.000Z", clockIso: "2026-10-23T01:55:00.000Z",
    });
    expect(snap.as_of_date).toBe("2026-10-22"); // shared envelope: Chicago, untouched (PM contract)
    expect(snap.as_of_timezone).toBe("America/Chicago");
    expect(report.as_of_date).toBe("2026-10-23"); // MM report: UTC civil date of the same instant
  });
});

describe("P670-002 — a future creation date is a named integrity condition, never a verified negative age", () => {
  it("created after the evaluation date: age unknown/unverifiable, WO_CREATED_DATE_IN_FUTURE, no bin_0_7 count", async () => {
    const { report } = await run(shell({ work_orders: [wo({ created_date: "2026-10-24" })] }));
    const row = report.sections.backlog.rows[0];
    expect(row.age_days).toBeNull();
    expect(row.age_bin).toBe("unknown");
    expect(row.aging_verifiable).toBe(false);
    expect(row.flags).toContain("AGING_UNVERIFIABLE");
    const kinds = report.sections.integrity.rows.map((r) => r.kind);
    expect(kinds).toContain("WO_CREATED_DATE_IN_FUTURE");
    expect(report.sections.backlog.by_bin.bin_0_7).toBe(0);
    expect(report.sections.backlog.unknown_age_count).toBe(1);
  });

  it("controls: created today is a verified age 0 and created yesterday a verified age 1 — neither is flagged", async () => {
    const { report } = await run(shell({
      work_orders: [wo({ work_order_ref: "wo-today", created_date: "2026-10-22" }), wo({ work_order_ref: "wo-yday", created_date: "2026-10-21" })],
    }));
    const byRef = Object.fromEntries(report.sections.backlog.rows.map((r) => [r.work_order_ref, r]));
    expect(byRef["wo-today"].age_days).toBe(0);
    expect(byRef["wo-today"].aging_verifiable).toBe(true);
    expect(byRef["wo-yday"].age_days).toBe(1);
    expect(report.sections.integrity.rows.map((r) => r.kind)).not.toContain("WO_CREATED_DATE_IN_FUTURE");
  });
});

describe("P670-003 — unit/property linkage must agree; request linkage is explicitly not verified", () => {
  it("contradictory linkage (ChatGPT's executed vector): WO names unit-1 and prop-2, unit-1 belongs to prop-1", async () => {
    const { report } = await run(shell({
      properties: [{ property_ref: "prop-1", owner_ref: "owner-a" }, { property_ref: "prop-2", owner_ref: "owner-a" }],
      work_orders: [wo({ property_ref: "prop-2" })],
    }));
    const rows = report.sections.integrity.rows.filter((r) => r.kind === "WO_UNIT_PROPERTY_MISMATCH");
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset).toBe("work_orders");
    expect(rows[0].record_ref).toBe("wo-1");
    expect(rows[0].unit_ref).toBe("unit-1");
    expect(rows[0].property_ref).toBe("prop-2");
    expect(rows[0].unit_property_ref).toBe("prop-1");
    // Neither source value is overwritten on the backlog row.
    expect(report.sections.backlog.rows).toHaveLength(1);
    expect(report.sections.backlog.rows[0].property_ref).toBe("prop-2");
    expect(report.sections.backlog.rows[0].unit_ref).toBe("unit-1");
  });

  it("matching linkage emits no mismatch; a dangling unit emits WO_UNIT_DANGLING only; no linkages emit nothing", async () => {
    const matching = await run(shell({ work_orders: [wo()] }));
    expect(matching.report.sections.integrity.rows.map((r) => r.kind)).not.toContain("WO_UNIT_PROPERTY_MISMATCH");
    const dangling = await run(shell({ work_orders: [wo({ unit_ref: "unit-ghost" })] }));
    const dKinds = dangling.report.sections.integrity.rows.map((r) => r.kind);
    expect(dKinds).toContain("WO_UNIT_DANGLING");
    expect(dKinds).not.toContain("WO_UNIT_PROPERTY_MISMATCH");
    const none = await run(shell({ work_orders: [wo({ unit_ref: undefined, property_ref: undefined })] }));
    const nKinds = none.report.sections.integrity.rows.map((r) => r.kind);
    expect(nKinds).not.toContain("WO_UNIT_DANGLING");
    expect(nKinds).not.toContain("WO_PROPERTY_DANGLING");
    expect(nKinds).not.toContain("WO_UNIT_PROPERTY_MISMATCH");
  });

  it("orphan-request status is an explicit NOT VERIFIED diagnostic, never a silent pass", async () => {
    const { report } = await run(shell({ work_orders: [wo({ request_ref: "req-orphan" })] }));
    expect(report.diagnostics.map((d) => d.code)).toContain("REQUEST_LINKAGE_NOT_VERIFIED");
    expect(report.sections.backlog.rows[0].request_ref).toBe("req-orphan");
  });
});

describe("P670-005 — integrity row identities are collision-safe across datasets", () => {
  it("one coverage gap per dataset yields three distinct decision identities", () => {
    const report = evaluateMaintenanceManagerSnapshot({
      as_of: "2026-10-22T14:00:00.000Z",
      owner_ref: "owner-a", portfolio_ref: "portfolio-a",
      records: { properties: [], units: [], work_orders: [] },
      conflicts: [],
      coverage_gaps: [
        { code: "COVERAGE_UNATTESTED", dataset: "properties" },
        { code: "COVERAGE_UNATTESTED", dataset: "units" },
        { code: "COVERAGE_UNATTESTED", dataset: "work_orders" },
      ],
      evidence: {}, consistency: "PARTIAL", stale: false,
      collection_errors: [], datasets: {}, digest: "d".repeat(64),
    });
    const ids = report.sections.integrity.rows.map((r) => r.row_id);
    expect(ids).toEqual([
      "int:COVERAGE_UNATTESTED:properties:coverage",
      "int:COVERAGE_UNATTESTED:units:coverage",
      "int:COVERAGE_UNATTESTED:work_orders:coverage",
    ]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("evaluator contract", () => {
  it("is pure and deterministic: identical bytes in -> identical report out", async () => {
    const data = shell({ work_orders: [wo(), wo({ work_order_ref: "wo-2", status: "in_progress", created_date: "2026-08-01", priority: "urgent", due_date: "2026-10-01" })] });
    const a = await run(data);
    const b = await run(data);
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
    expect(a.report.evaluator_version).toBe(EVALUATOR_VERSION);
    expect(a.report.agent).toBe("maintenance-manager");
    expect(a.report.kind).toBe("maintenance-manager-backlog-review");
    expect(a.report.window).toEqual({ name: "maintenance-backlog-open" });
    expect(a.report.execution_authorized).toBe(false);
  });

  it("no_exceptions_found only when the backlog and integrity are both empty", async () => {
    const empty = await run(shell());
    expect(empty.report.no_exceptions_found).toBe(true);
    expect(empty.report.status).toBe("PROPOSED");
    const withBacklog = await run(shell({ work_orders: [wo()] }));
    expect(withBacklog.report.no_exceptions_found).toBe(false);
  });

  it("PII-shaped fields outside the projection never reach the report", async () => {
    const { snap, report } = await run(shell({
      work_orders: [wo({ tenant_name: "CANARY-NAME-MM", scope_of_work: "leaky pipe in kitchen", contractor_phone: "555-0102" })],
    }));
    const bytes = JSON.stringify({ snap: snap.records, report });
    expect(bytes).not.toContain("CANARY-NAME-MM");
    expect(bytes).not.toContain("leaky pipe");
    expect(bytes).not.toContain("555-0102");
    expect(snap.evidence.work_orders["wo-1"].dropped_fields).toContain("tenant_name");
  });
});
