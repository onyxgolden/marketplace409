/**
 * Focused vitest suite for the P2b-1 planning application surface.
 * Mirrors the P2a rental-ops test pattern (globals, node env).
 * Covers every mapping rule in sourceMappings.js plus the withhold
 * rules, the serializer's duplicate-identity rule, and the decision
 * contract. The 80-case battery (scripts/ai-agents/planning-wiring/
 * battery/) is the exhaustive wiring proof; these tests are the
 * readable unit net.
 */
import { describe, expect, it } from "vitest";
import { Budget } from "../rental-ops/budgets.js";
import { PLANNING_BUDGET_LIMITS } from "../../../../scripts/ai-agents/planning-wiring/src/planningBudget.js";
import { PLANNING_DATASETS, projectRow } from "./fieldMappings.js";
import {
  JOB_KINDS, JobRefusal, descriptorFor, requireSchedulerScope, resolveMode, validateJobRequest,
} from "./jobContracts.js";
import { buildSnapshot } from "./snapshotBuilder.js";
import { buildNetwork } from "./sourceMappings.js";
import { evaluateSchedulerSnapshot } from "./schedulerAssessment.js";
import { reportRowIds, serializePrivateItem } from "./privateItemSerializer.js";
import { validateDecision } from "./decisionValidator.js";

const AS_OF = "2026-10-26T12:00:00.000Z";
const clock = { nowIso: () => AS_OF };

function request(overrides = {}) {
  return {
    principal_ref: "principal-1", owner_ref: "owner-1",
    project_scope_ref: { type: "scheduling-project", id: "P-1" },
    job_kind: JOB_KINDS.SCHEDULER_PLANNING_REVIEW, job_version: 1,
    as_of: AS_OF, window: { name: "planning-lookahead-14-civil-days" },
    snapshot_request_id: "snap-1", ...overrides,
  };
}

function adapter(datasets, { pageSize = 100, authorizedGlobals = [], leakyOwners = false } = {}) {
  const scopeId = "P-1";
  const globals = new Set(authorizedGlobals);
  return {
    source_system: "synthetic-repository",
    async collect(dataset, { owner_ref, cursor }) {
      const all = (datasets[dataset] ?? []).filter((r) => {
        if (!leakyOwners && r.owner_ref !== owner_ref) return false;
        if (dataset === "schedule_projects") return r.project_ref === scopeId;
        if (dataset === "schedule_calendars") {
          return r.project_ref === scopeId || ((r.project_ref === null || r.project_ref === undefined) && globals.has(r.calendar_ref));
        }
        if (["schedule_lanes", "schedule_blocks", "schedule_blackout_windows"].includes(dataset)) return r.project_ref === scopeId;
        if (dataset === "schedule_calendar_holidays") {
          const served = (datasets.schedule_calendars ?? []).filter((c) =>
            c.project_ref === scopeId || ((c.project_ref === null || c.project_ref === undefined) && globals.has(c.calendar_ref)));
          return served.some((c) => c.calendar_ref === r.calendar_ref);
        }
        if (dataset === "schedule_dependencies") {
          const ids = new Set((datasets.schedule_blocks ?? []).filter((b) => b.project_ref === scopeId).map((b) => b.block_ref));
          return ids.has(r.predecessor_ref) || ids.has(r.successor_ref);
        }
        return true;
      });
      const start = cursor === null ? 0 : Number(cursor);
      const rows = all.slice(start, start + pageSize);
      const next = start + pageSize < all.length ? String(start + pageSize) : null;
      return { rows, next_cursor: next, revision: "rev-1", expected_total: all.length };
    },
    close() {},
  };
}

function datasets(overrides = {}) {
  const base = {
    schedule_projects: [{ project_ref: "P-1", owner_ref: "owner-1", start_date: "2026-10-26", end_date: "2026-12-31", default_calendar_ref: "CAL-1" }],
    schedule_calendars: [{ calendar_ref: "CAL-1", project_ref: "P-1", owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5] }],
    schedule_calendar_holidays: [{ holiday_ref: "HOL-1", calendar_ref: "CAL-1", owner_ref: "owner-1", holiday_date: "2026-10-27" }],
    schedule_blackout_windows: [{ blackout_ref: "BLK-1", project_ref: "P-1", owner_ref: "owner-1", start_date: "2026-10-30", end_date: "2026-10-30" }],
    schedule_lanes: [{ lane_ref: "L-1", project_ref: "P-1", owner_ref: "owner-1", calendar_ref: "CAL-1" }],
    schedule_blocks: [],
    schedule_dependencies: [],
  };
  return { ...base, ...overrides };
}

function block(id, overrides = {}) {
  return {
    block_ref: id, project_ref: "P-1", lane_ref: "L-1", wbs_node_ref: null,
    owner_ref: "owner-1", task_code: id, block_type: "task", start_date: null,
    duration_days: 1, percent_complete: 0, calendar_ref: null,
    constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null,
    ...overrides,
  };
}

function tie(id, pred, succ, overrides = {}) {
  return {
    dependency_ref: id, predecessor_ref: pred, successor_ref: succ,
    owner_ref: "owner-1", relationship_type: "FS", lag_days: 0, ...overrides,
  };
}

async function snapshotFor(ds, opts = {}) {
  const budget = new Budget(PLANNING_BUDGET_LIMITS);
  return buildSnapshot({
    request: request(opts.requestOverrides),
    adapter: adapter(ds, opts), budget, clock: opts.clock ?? clock,
    datasets: PLANNING_DATASETS,
    authorizedGlobalRefs: new Set(opts.authorizedGlobals ?? []),
  });
}

describe("jobContracts", () => {
  it("accepts the closed Scheduler request and rejects unknown fields", () => {
    expect(() => validateJobRequest(request())).not.toThrow();
    expect(() => validateJobRequest(request({ mode: "live" }))).toThrow(JobRefusal);
    expect(() => validateJobRequest(request({ job_version: 2 }))).toThrow(JobRefusal);
    expect(() => validateJobRequest(request({ window: { name: "planning-latest-through-asof" } }))).toThrow(JobRefusal);
  });
  it("resolves host-owned modes; live/production demand activation", () => {
    expect(resolveMode("DISABLED")).toBe("DISABLED");
    expect(resolveMode("SYNTHETIC_PREVIEW")).toBe("SYNTHETIC_PREVIEW");
    expect(() => resolveMode("LIVE")).toThrow(JobRefusal);
    expect(() => resolveMode("PRODUCTION")).toThrow(JobRefusal);
  });
  it("descriptors: Scheduler WIRED_INERT, Controls/Manager NOT_BUILT", () => {
    expect(descriptorFor(JOB_KINDS.SCHEDULER_PLANNING_REVIEW).readiness).toBe("WIRED_INERT");
    expect(descriptorFor(JOB_KINDS.CONTROLS_EVIDENCE_REVIEW).readiness).toBe("NOT_BUILT_P2B2");
    expect(descriptorFor(JOB_KINDS.PM_PLAN_HEALTH_REVIEW).readiness).toBe("NOT_BUILT_P2B3");
    expect(descriptorFor("nope")).toBeNull();
  });
  it("requireSchedulerScope refuses non-scheduling scopes", () => {
    expect(() => requireSchedulerScope(request())).not.toThrow();
    expect(() => requireSchedulerScope(request({ project_scope_ref: { type: "package", id: "P-1" } }))).toThrow(JobRefusal);
  });
});

describe("fieldMappings projection", () => {
  it("drops cost, CPM-computed, label and styling fields; keeps admitted refs", () => {
    const { row, dropped } = projectRow("schedule_blocks", {
      ...block("A"), label: "CANARY", cost_usd: 1, early_start: "2026-10-26", total_float_days: 3,
    });
    expect(row.label).toBeUndefined();
    expect(row.cost_usd).toBeUndefined();
    expect(row.early_start).toBeUndefined();
    expect(row.total_float_days).toBeUndefined();
    expect(row.block_ref).toBe("A");
    expect(dropped).toContain("label");
  });
  it("rejects invalid weekday masks: working_days becomes undefined + invalid, never a default", () => {
    const { row, invalid } = projectRow("schedule_calendars", {
      calendar_ref: "C", project_ref: "P-1", owner_ref: "owner-1", working_days: [1, 8],
    });
    expect(row.working_days).toBeUndefined();
    expect(invalid).toContain("working_days");
  });
});

describe("snapshotBuilder", () => {
  it("admits the canonical project and attests one revision", async () => {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("A", { duration_days: 2 }), block("B", { duration_days: 3 })],
      schedule_dependencies: [tie("T-AB", "A", "B")],
    }));
    expect(snap.consistency).toBe("CONSISTENT");
    expect(snap.source_revision).toBe("rev-1");
    expect(snap.records.schedule_blocks).toHaveLength(2);
  });
  it("refuses cross-owner rows (builder defense-in-depth behind a leaky adapter)", async () => {
    const budget = new Budget(PLANNING_BUDGET_LIMITS);
    await expect(buildSnapshot({
      request: request(),
      adapter: adapter(datasets({
        schedule_blocks: [block("A"), block("X", { owner_ref: "owner-2" })],
      }), { leakyOwners: true }),
      budget, clock, datasets: PLANNING_DATASETS, authorizedGlobalRefs: new Set(),
    })).rejects.toThrow(JobRefusal);
  });
  it("pagination is order-invariant", async () => {
    const ds = datasets({ schedule_blocks: [block("A"), block("B"), block("C")] });
    const a = await snapshotFor(ds);
    const b = await snapshotFor(ds, { pageSize: 1 });
    expect(b.digest).toBe(a.digest);
  });
  it("stale collection marks PARTIAL; future collection refuses", async () => {
    const stale = await snapshotFor(datasets({}), { clock: { nowIso: () => "2026-10-26T11:30:00.000Z" } });
    expect(stale.consistency).toBe("PARTIAL");
    expect(stale.stale).toBe(true);
    await expect(snapshotFor(datasets({}), { clock: { nowIso: () => "2026-10-26T12:30:00.000Z" } }))
      .rejects.toThrow(/SNAPSHOT_FROM_FUTURE/);
  });
  it("looping cursor marks the dataset partial with CURSOR_FAULT", async () => {
    const looping = {
      source_system: "synthetic-repository",
      async collect(dataset, { cursor }) {
        if (dataset !== "schedule_blocks") {
          return { rows: [], next_cursor: null, revision: "rev-1", expected_total: 0 };
        }
        return { rows: [], next_cursor: "loop", revision: "rev-1", expected_total: 0 };
      },
      close() {},
    };
    const budget = new Budget(PLANNING_BUDGET_LIMITS);
    const snap = await buildSnapshot({
      request: request(), adapter: looping, budget, clock,
      datasets: PLANNING_DATASETS, authorizedGlobalRefs: new Set(),
    });
    expect(snap.consistency).toBe("PARTIAL");
    expect(snap.collection_errors.some((e) => e.code === "CURSOR_FAULT")).toBe(true);
  });
  it("P676-003: missing/null project_ref on a project-scoped row refuses SCOPE_VIOLATION (no scope by omission)", async () => {
    // Passthrough adapter: serves rows verbatim, like a leaky
    // future adapter — the builder's boundary must refuse the
    // identity-less rows itself, not admit them into the scope.
    const passthrough = (ds) => ({
      source_system: "synthetic-repository",
      async collect(dataset) {
        const rows = ds[dataset] ?? [];
        return { rows, next_cursor: null, revision: "rev-1", expected_total: rows.length };
      },
      close() {},
    });
    const budget = new Budget(PLANNING_BUDGET_LIMITS);
    await expect(buildSnapshot({
      request: request(),
      adapter: passthrough(datasets({ schedule_blocks: [block("A"), block("X", { project_ref: null })] })),
      budget, clock, datasets: PLANNING_DATASETS, authorizedGlobalRefs: new Set(),
    })).rejects.toThrow(/SCOPE_VIOLATION/);
    await expect(buildSnapshot({
      request: request(),
      adapter: passthrough(datasets({
        schedule_projects: [{ project_ref: null, owner_ref: "owner-1", start_date: "2026-10-26", end_date: "2026-12-31", default_calendar_ref: "CAL-1" }],
      })),
      budget, clock, datasets: PLANNING_DATASETS, authorizedGlobalRefs: new Set(),
    })).rejects.toThrow(/SCOPE_VIOLATION/);
    await expect(buildSnapshot({
      request: request(),
      adapter: passthrough(datasets({
        schedule_lanes: [{ lane_ref: "L-9", owner_ref: "owner-1", calendar_ref: "CAL-1" }],
      })),
      budget, clock, datasets: PLANNING_DATASETS, authorizedGlobalRefs: new Set(),
    })).rejects.toThrow(/SCOPE_VIOLATION/);
  });
  it("P676-003: non-scalar allowlisted fields are FIELD_INVALID errors, never silently dropped", async () => {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("A", { duration_days: { nested: true } })],
    }));
    expect(snap.consistency).toBe("PARTIAL");
    expect(snap.collection_errors.some((e) => e.code === "FIELD_INVALID" && e.field === "duration_days")).toBe(true);
    const net = buildNetwork(snap);
    expect(net.findings.some((f) => f.kind === "MISSING_DURATION")).toBe(true);
    const badCal = await snapshotFor(datasets({
      schedule_calendars: [{ calendar_ref: "CAL-1", project_ref: "P-1", owner_ref: "owner-1", working_days: [1, 8] }],
    }));
    expect(badCal.collection_errors.some((e) => e.code === "FIELD_INVALID" && e.field === "working_days")).toBe(true);
  });
});

describe("sourceMappings + schedulerAssessment", () => {
  it("canonical network: exact FS math with holiday + blackout working ticks", async () => {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("A", { duration_days: 2 }), block("B", { duration_days: 3 }),
        block("C", { block_type: "milestone", duration_days: 0, start_date: "2026-10-28" })],
      schedule_dependencies: [tie("T-AB", "A", "B"), tie("T-BC", "B", "C")],
    }));
    const net = buildNetwork(snap);
    expect(net.components).toHaveLength(1);
    expect(net.components[0].conclusion).toBe("READY");
    const report = evaluateSchedulerSnapshot(snap);
    const comp = report.sections.components.rows[0];
    const byId = new Map(comp.activities.map((a) => [a.block_ref, a]));
    expect(byId.get("A")).toMatchObject({ es_tick: 0, ef_tick: 2, critical: true, computed_start: "2026-10-26" });
    expect(byId.get("B")).toMatchObject({ es_tick: 2, ef_tick: 5, critical: true, computed_start: "2026-10-29" });
    expect(byId.get("C")).toMatchObject({ es_tick: 5, ef_tick: 5, critical: true, computed_start: "2026-11-04" });
    // Declared C start (10-28) disagrees with computed (11-04).
    const look = report.sections.lookahead.rows.find((r) => r.block_ref === "C");
    expect(look.disagreement).toMatch(/2026-10-28.*2026-11-04/);
    expect(report.status).toBe("DRAFT");
    expect(report.execution_authorized).toBe(false);
  });
  it("nonzero lag qualifies the component and withholds exact math", async () => {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("A"), block("B")],
      schedule_dependencies: [tie("T-AB", "A", "B", { lag_days: 2 })],
    }));
    const net = buildNetwork(snap);
    expect(net.components[0].conclusion).toBe("QUALIFIED");
    expect(net.findings.some((f) => f.kind === "NONZERO_LAG_NOT_MODELED")).toBe(true);
  });
  it("P676-001: a failed dependency read can never publish READY components or READY lookahead conclusions", async () => {
    const failingDeps = {
      source_system: "synthetic-repository",
      async collect(dataset, { cursor }) {
        if (dataset === "schedule_dependencies") throw Object.assign(new Error("source down"), { code: "SOURCE_DOWN" });
        const base = adapter(datasets({
          schedule_blocks: [block("A", { duration_days: 2 }), block("B", { duration_days: 3 }),
            block("C", { block_type: "milestone", duration_days: 0, start_date: "2026-10-28" })],
          schedule_dependencies: [tie("T-AB", "A", "B"), tie("T-BC", "B", "C")],
        }), {});
        return base.collect(dataset, { owner_ref: "owner-1", cursor });
      },
      close() {},
    };
    const budget = new Budget(PLANNING_BUDGET_LIMITS);
    const snap = await buildSnapshot({
      request: request(), adapter: failingDeps, budget, clock,
      datasets: PLANNING_DATASETS, authorizedGlobalRefs: new Set(),
    });
    expect(snap.consistency).toBe("PARTIAL");
    expect(snap.datasets.schedule_dependencies.complete).toBe(false);
    const report = evaluateSchedulerSnapshot(snap);
    expect(report.sections.components.rows.length).toBeGreaterThan(0);
    for (const c of report.sections.components.rows) {
      expect(c.conclusion).not.toBe("READY");
      expect(c.qualifications.join(" ")).toMatch(/schedule_dependencies/);
    }
    for (const r of report.sections.lookahead.rows) {
      expect(r.computed_conclusion).not.toBe("READY");
    }
  });
  it("P676-002: an unsupported relationship type qualifies the component and withholds every computed date", async () => {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("A"), block("B")],
      schedule_dependencies: [tie("T-AB", "A", "B", { relationship_type: "XX" })],
    }));
    const net = buildNetwork(snap);
    expect(net.components).toHaveLength(1);
    expect(net.components[0].conclusion).toBe("QUALIFIED");
    expect(net.components[0].withheld["A"]).toMatch(/all-computed-withheld/);
    expect(net.components[0].withheld["B"]).toMatch(/all-computed-withheld/);
    expect(net.findings.some((f) => f.kind === "UNSUPPORTED_TIE_TYPE")).toBe(true);
    for (const a of net.components[0].activities) {
      expect(a.es).toBeNull();
      expect(a.ef).toBeNull();
      expect(a.ls).toBeNull();
      expect(a.lf).toBeNull();
      expect(a.critical).toBeNull();
    }
  });
  it("mixed calendars fail the component; must_start_on withholds successors; SNLT withholds late fields", async () => {
    const mixed = await snapshotFor(datasets({
      schedule_calendars: [
        { calendar_ref: "CAL-1", project_ref: "P-1", owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5] },
        { calendar_ref: "CAL-2", project_ref: "P-1", owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5, 6] },
      ],
      schedule_blocks: [block("A", { calendar_ref: "CAL-1" }), block("B", { calendar_ref: "CAL-2" })],
      schedule_dependencies: [tie("T-AB", "A", "B")],
    }));
    expect(buildNetwork(mixed).components[0].conclusion).toBe("NOT_MODELED");
    const mso = await snapshotFor(datasets({
      schedule_blocks: [block("A", { constraint_type: "must_start_on", constraint_date: "2026-10-28" }), block("B")],
      schedule_dependencies: [tie("T-AB", "A", "B")],
    }));
    const msoNet = buildNetwork(mso);
    expect(msoNet.components[0].withheld["A"]).toMatch(/all-computed-withheld/);
    expect(msoNet.components[0].withheld["B"]).toMatch(/all-computed-withheld/);
    const snlt = await snapshotFor(datasets({
      schedule_blocks: [block("A"), block("B", { constraint_type: "SNLT", constraint_date: "2026-10-28" })],
      schedule_dependencies: [tie("T-AB", "A", "B")],
    }));
    const snltComp = buildNetwork(snlt).components[0];
    expect(snltComp.withheld["A"]).toMatch(/late-withheld/);
    expect(snltComp.withheld["B"]).toMatch(/late-withheld/);
    const snltActivity = snltComp.activities.find((a) => a.id === "A");
    expect(snltActivity.es).toBe(0);
    expect(snltActivity.ls).toBeNull();
  });
  it("hammocks and WBS-only blocks are inventoried, never math", async () => {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("H", { block_type: "hammock", duration_days: 0 }),
        block("W", { lane_ref: null, wbs_node_ref: "WBS-1", duration_days: 2 })],
    }));
    const net = buildNetwork(snap);
    expect(net.components).toHaveLength(0);
    expect(net.inventory.hammocks).toBe(1);
    expect(net.inventory.wbs_only).toBe(1);
  });
  it("overdue incomplete milestones list separately from the lookahead window", async () => {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("D", { block_type: "milestone", duration_days: 0, start_date: "2026-10-20", percent_complete: 50 })],
    }));
    const report = evaluateSchedulerSnapshot(snap);
    expect(report.sections.lookahead.rows).toHaveLength(1);
    expect(report.sections.lookahead.rows[0].bucket).toBe("OVERDUE");
  });
});

describe("privateItemSerializer + decisionValidator", () => {
  async function publishedItem() {
    const snap = await snapshotFor(datasets({
      schedule_blocks: [block("A", { duration_days: 2 })],
    }));
    const report = evaluateSchedulerSnapshot(snap);
    return serializePrivateItem({ report, snapshot: snap, publishedAt: AS_OF });
  }
  it("identical content serializes to the identical item id (idempotent publish)", async () => {
    const a = await publishedItem();
    const b = await publishedItem();
    expect(a.item_id).toBe(b.item_id);
    expect(a.report_digest).toBe(b.report_digest);
    expect(a.execution_authorized).toBe(false);
  });
  it("two distinct rows sharing one row id refuse DUPLICATE_ROW_IDENTITY", async () => {
    const item = await publishedItem();
    const forged = JSON.parse(JSON.stringify(item.report));
    const rows = forged.sections.components.rows;
    rows.push({ ...rows[0], component_id: "comp-FORGED" });
    expect(() => reportRowIds(forged)).toThrow(/DUPLICATE_ROW_IDENTITY/);
  });
  it("decision binding: stale digest, unknown row, bad enum refuse; valid decision passes", async () => {
    const item = await publishedItem();
    const base = {
      item_id: item.item_id, report_digest: item.report_digest, row_id: item.row_ids[0],
      actor: "operator", decision: "acknowledge", at: AS_OF, decision_id: "d-1",
    };
    expect(validateDecision(item, base)).toMatchObject({ decision: "acknowledge" });
    expect(() => validateDecision(item, { ...base, report_digest: "stale" })).toThrow(/STALE_DIGEST/);
    expect(() => validateDecision(item, { ...base, row_id: "sch-nope" })).toThrow(/UNKNOWN_ROW/);
    expect(() => validateDecision(item, { ...base, decision: "approve-schedule" })).toThrow(/BAD_DECISION/);
    expect(() => validateDecision(item, { ...base, decision: "execute" })).toThrow(/BAD_DECISION/);
  });
});
