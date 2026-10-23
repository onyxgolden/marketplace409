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
