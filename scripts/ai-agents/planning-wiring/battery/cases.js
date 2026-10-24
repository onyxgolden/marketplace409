/**
 * Planning battery cases (80). Each case runs the full inert
 * runner three times against ONE shared publisher with a fixed clock
 * and fixed source; the published item must be byte-identical across
 * runs and must match the oracle's expectation for the case.
 *
 * Cases are data + small builders, not candidate logic: the oracle
 * (oracle.js) asserts outcomes, codes, counts, hand-computed dates
 * and finding kinds. It imports NOTHING from the evaluator, the
 * snapshot builder, the mapping layer or the prototype math — only
 * canonical JSON primitives for digest recomputation.
 *
 * Groups: A domain/boundary (20), B coverage/version/calendar/
 * mapping (20), C authority/prohibited-data/operation/injection
 * (20), D budget/durability/replay/timeout (20).
 *
 * A case's `build` returns { host, request, spec, faults?, clock }.
 * `post` names an optional harness step run after the three runner
 * runs (decision/trust/deadline proofs that are not runner runs
 * themselves); the runner invariant still holds for the case.
 */
import {
  CANONICAL_AS_OF, CANONICAL_HOST, CANONICAL_PROJECT, canonicalRequest, canonicalSpec,
} from "../src/fixtures.js";

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function specWith(datasets, faults = {}, authorized = []) {
  return { kind: "synthetic", datasets, faults, authorized_global_calendar_refs: authorized };
}

function hostWith(overrides = {}) {
  return { ...clone(CANONICAL_HOST), ...overrides };
}

function requestWith(overrides = {}) {
  return { ...clone(canonicalRequest()), ...overrides };
}

function datasetsWith(mutator) {
  const d = clone(CANONICAL_PROJECT);
  mutator(d);
  return d;
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

// --- Group A: domain / boundary ------------------------------------
const A = [
  {
    id: "A01", group: "A", title: "canonical happy path: exact FS math, lookahead disagreement, overdue milestone",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    expect: { outcome: "COMPLETED", report_status: "DRAFT",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 0, ef: 2, ls: 0, lf: 2, total_float: 0, critical: true, civil_start: "2026-10-26", civil_finish_boundary: "2026-10-29" },
          B: { es: 2, ef: 5, ls: 2, lf: 5, total_float: 0, critical: true, civil_start: "2026-10-29", civil_finish_boundary: "2026-11-04" },
          C: { es: 5, ef: 5, ls: 5, lf: 5, total_float: 0, critical: true, civil_start: "2026-11-04", civil_finish_boundary: "2026-11-04" } } },
        { id: "comp-D", conclusion: "READY",
          activities: { D: { es: 0, ef: 0, ls: 0, lf: 0, total_float: 0, critical: true, civil_start: "2026-10-26", civil_finish_boundary: "2026-10-26" } } }],
      lookahead: [{ block_ref: "C", bucket: "LOOKAHEAD", disagreement: true },
        { block_ref: "D", bucket: "OVERDUE", disagreement: true }] },
  },
  {
    id: "A02", group: "A", title: "complete empty report: project with no blocks is COMPLETE-empty, not an error",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.schedule_blocks = []; d.schedule_dependencies = []; })) }),
    expect: { outcome: "COMPLETED", report_status: "DRAFT", components: [], lookahead: [], integrity_kinds: [] },
  },
  {
    id: "A03", group: "A", title: "lookahead end is exclusive: milestone exactly at review+14 is not in the window",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks.push(block("E", { block_type: "milestone", duration_days: 0, start_date: "2026-11-09" }));
      })) }),
    expect: { outcome: "COMPLETED", lookahead_blocks: ["D", "C"] },
  },
  {
    id: "A04", group: "A", title: "milestone on the review date itself is inside the window",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks.push(block("E", { block_type: "milestone", duration_days: 0, start_date: "2026-10-26" }));
      })) }),
    expect: { outcome: "COMPLETED", lookahead_blocks: ["D", "E", "C"] },
  },
  {
    id: "A05", group: "A", title: "leap day: project anchored 2028-02-29 rolls working ticks across Feb 29",
    build: () => ({ host: hostWith(), request: requestWith({ as_of: "2028-02-29T12:00:00.000Z" }),
      spec: specWith(datasetsWith((d) => {
        d.schedule_projects[0].start_date = "2028-02-29";
        d.schedule_calendar_holidays = [];
        d.schedule_blackout_windows = [];
        d.schedule_blocks = [block("A", { duration_days: 2, start_date: "2028-02-29" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 0, ef: 2, ls: 0, lf: 2, civil_start: "2028-02-29", civil_finish_boundary: "2028-03-02" } } }] },
  },
  {
    id: "A06", group: "A", title: "holiday rolls the anchor forward: anchor on a holiday is not tick 0",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_projects[0].start_date = "2026-10-27";
        d.schedule_calendar_holidays = [{ holiday_ref: "HOL-1", calendar_ref: "CAL-1", owner_ref: "owner-1", holiday_date: "2026-10-27" }];
        d.schedule_blocks = [block("A", { duration_days: 1, start_date: "2026-10-27" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 0, ef: 1, civil_start: "2026-10-28", civil_finish_boundary: "2026-10-29" } } }] },
  },
  {
    id: "A07", group: "A", title: "blackout window excludes its dates from every calendar in the project",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 2 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 0, ef: 2, civil_start: "2026-10-26", civil_finish_boundary: "2026-10-29" } } }] },
  },
  {
    id: "A08", group: "A", title: "SNET/start_on binds exactly at the rolled working day",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, constraint_type: "SNET", constraint_date: "2026-10-28" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 1, ef: 2, civil_start: "2026-10-28", civil_finish_boundary: "2026-10-29" } } }] },
  },
  {
    id: "A09", group: "A", title: "FNET/finish_on converts through the app ES-equivalent (duration-1 working steps back)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 2, constraint_type: "FNET", constraint_date: "2026-10-29" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 1, ef: 3, civil_start: "2026-10-28", civil_finish_boundary: "2026-11-02" } } }] },
  },
  {
    id: "A10", group: "A", title: "FNLT converts to the next working boundary: FNLT 10-28 (tick 1) binds lf at tick 2, not tick 1",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 2, constraint_type: "FNLT", constraint_date: "2026-10-28" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 0, ef: 2, ls: 0, lf: 2, civil_start: "2026-10-26", civil_finish_boundary: "2026-10-29" } } }] },
  },
  {
    id: "A11", group: "A", title: "must_finish_on pins both bounds at the next-working boundary tick (finish 10-29 -> boundary 11-02)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, constraint_type: "must_finish_on", constraint_date: "2026-10-29" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 2, ef: 3, ls: 2, lf: 3, civil_start: "2026-10-29", civil_finish_boundary: "2026-11-02" } } }] },
  },
  {
    id: "A12", group: "A", title: "ALAP is math-inert (prototype dates reported, app override divergence named)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, constraint_type: "ALAP" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 0, ef: 1, civil_start: "2026-10-26" } } }] },
  },
  {
    id: "A13", group: "A", title: "ASAP carries no constraint and no finding",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, constraint_type: "ASAP" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds: [] },
  },
  {
    id: "A14", group: "A", title: "SS/FF/SF lag-0 ties map exactly (prototype signed-lag weights)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 2 }), block("B", { duration_days: 2 }), block("C", { duration_days: 2 })];
        d.schedule_dependencies = [tie("T-SS", "A", "B", { relationship_type: "SS" }), tie("T-FF", "B", "C", { relationship_type: "FF" })];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY",
        activities: { A: { es: 0, ef: 2 }, B: { es: 0, ef: 2 }, C: { es: 0, ef: 2 } } }] },
  },
  {
    id: "A15", group: "A", title: "islands: two disconnected components are evaluated independently",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("Z", { duration_days: 1 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", component_ids: ["comp-A", "comp-Z"] },
  },
  {
    id: "A16", group: "A", title: "cycle: the component yields NO computed dates (all-or-nothing, not partial math)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("B", { duration_days: 1 })];
        d.schedule_dependencies = [tie("T-AB", "A", "B"), tie("T-BA", "B", "A")];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "NOT_MODELED", prototype_status: "CYCLE_DETECTED", activities_null: true }],
      review_kinds: ["INSPECT_CYCLE"] },
  },
  {
    id: "A17", group: "A", title: "dangling tie: endpoint outside the admitted set fails the component, no dates",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 })];
        d.schedule_dependencies = [tie("T-AX", "A", "GHOST")];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "NOT_MODELED", prototype_status: "DANGLING_TIE", activities_null: true }] },
  },
  {
    id: "A18", group: "A", title: "cross-scope tie: one endpoint in, one endpoint in a WBS-only block — component fails",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("W", { lane_ref: null, wbs_node_ref: "WBS-1", duration_days: 1 })];
        d.schedule_dependencies = [tie("T-AW", "A", "W")];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "NOT_MODELED" }] },
  },
  {
    id: "A19", group: "A", title: "hammock tie: a tie touching a hammock is a finding, never math",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("H", { block_type: "hammock", duration_days: 0 })];
        d.schedule_dependencies = [tie("T-AH", "A", "H")];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["HAMMOCK_TIE"] },
  },
  {
    id: "A20", group: "A", title: "horizon: a duration past 366 civil days refuses the component, never guesses",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 400 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "NOT_MODELED" }] },
  },
];

export { A };

// --- Group B: coverage / version / calendar / mapping --------------
const B = [
  {
    id: "B01", group: "B", title: "missing calendar: block with no resolvable calendar is MISSING_CALENDAR, component NOT_MODELED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_calendars = [];
        d.schedule_lanes[0].calendar_ref = null;
        d.schedule_projects[0].default_calendar_ref = null;
        d.schedule_blocks = [block("A", { duration_days: 1 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["MISSING_CALENDAR"],
      components: [{ id: "comp-A", conclusion: "NOT_MODELED" }] },
  },
  {
    id: "B02", group: "B", title: "missing duration: null duration_days is MISSING_DURATION, never defaulted to 0 or 1, and never a component",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: null })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["MISSING_DURATION"], components: [] },
  },
  {
    id: "B03", group: "B", title: "no calendar fallback: absent block/lane/project calendars never fall back to a synthetic 7-day week",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_lanes[0].calendar_ref = null;
        d.schedule_projects[0].default_calendar_ref = null;
        d.schedule_calendars = [];
        d.schedule_blocks = [block("A", { duration_days: 1 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["MISSING_CALENDAR"] },
  },
  {
    id: "B04", group: "B", title: "authorized global calendar (project_ref null, in the host set) is admitted",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_calendars = [{ calendar_ref: "GCAL", project_ref: null, owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5] }];
        d.schedule_lanes[0].calendar_ref = "GCAL";
        d.schedule_blocks = [block("A", { duration_days: 1 })];
        d.schedule_dependencies = [];
      }), {}, ["GCAL"]) }),
    expect: { outcome: "COMPLETED",
      components: [{ id: "comp-A", conclusion: "READY", activities: { A: { es: 0, ef: 1, civil_start: "2026-10-26" } } }] },
  },
  {
    id: "B05", group: "B", title: "unauthorized global calendar is never served as a fallback: MISSING_CALENDAR, no mask leak",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_calendars = [{ calendar_ref: "GCAL", project_ref: null, owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5] }];
        d.schedule_lanes[0].calendar_ref = "GCAL";
        d.schedule_blocks = [block("A", { duration_days: 1 })];
        d.schedule_dependencies = [];
      }), {}, []) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["MISSING_CALENDAR"],
      components: [{ id: "comp-A", conclusion: "NOT_MODELED" }] },
  },
  {
    id: "B06", group: "B", title: "mixed calendars in one component: MIXED_CALENDARS, component NOT_MODELED (prototype takes one calendar)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_calendars.push({ calendar_ref: "CAL-2", project_ref: "P-1", owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5, 6] });
        d.schedule_blocks = [block("A", { duration_days: 1, calendar_ref: "CAL-1" }), block("B", { duration_days: 1, calendar_ref: "CAL-2" })];
        d.schedule_dependencies = [tie("T-AB", "A", "B")];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["MIXED_CALENDARS"],
      components: [{ id: "comp-A", conclusion: "NOT_MODELED" }] },
  },
  {
    id: "B07", group: "B", title: "nonzero lag: calendar-day lag has no working-day equivalent — tie NOT_MODELED, component QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("B", { duration_days: 1 })];
        d.schedule_dependencies = [tie("T-AB", "A", "B", { lag_days: 2 })];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["NONZERO_LAG_NOT_MODELED"],
      components: [{ id: "comp-A", conclusion: "QUALIFIED" }] },
  },
  {
    id: "B08", group: "B", title: "lag beyond the prototype bound (|lag| > 366) is NOT_MODELED, never clamped",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("B", { duration_days: 1 })];
        d.schedule_dependencies = [tie("T-AB", "A", "B", { lag_days: 400 })];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["NONZERO_LAG_NOT_MODELED"] },
  },
  {
    id: "B09", group: "B", title: "must_start_on: UNSUPPORTED withholds the activity AND its transitive successors",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, constraint_type: "must_start_on", constraint_date: "2026-10-28" }), block("B", { duration_days: 1 })];
        d.schedule_dependencies = [tie("T-AB", "A", "B")];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["UNSUPPORTED_CONSTRAINT"],
      components: [{ id: "comp-A", conclusion: "QUALIFIED", withheld_all: ["A", "B"] }] },
  },
  {
    id: "B10", group: "B", title: "SNLT: UNSUPPORTED withholds late fields for the activity AND its transitive predecessors; early dates stay exact",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("B", { duration_days: 1, constraint_type: "SNLT", constraint_date: "2026-10-28" })];
        d.schedule_dependencies = [tie("T-AB", "A", "B")];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["UNSUPPORTED_CONSTRAINT"],
      components: [{ id: "comp-A", conclusion: "QUALIFIED",
        activities: { A: { es: 0, ef: 1, ls: null, lf: null, critical: null }, B: { es: 1, ef: 2, ls: null, lf: null, critical: null } } }] },
  },
  {
    id: "B11", group: "B", title: "unknown constraint_type is an UNSUPPORTED finding, never a silent bound",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, constraint_type: "WHENEVER", constraint_date: "2026-10-28" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["UNSUPPORTED_CONSTRAINT"] },
  },
  {
    id: "B12", group: "B", title: "constraint beyond the horizon is UNSUPPORTED_CONSTRAINT_HORIZON, never guessed",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, constraint_type: "SNET", constraint_date: "2028-06-01" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["UNSUPPORTED_CONSTRAINT_HORIZON"] },
  },
  {
    id: "B13", group: "B", title: "WBS-only blocks are inventoried, never math: no component, no dates, no silent drop",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("W", { lane_ref: null, wbs_node_ref: "WBS-1", duration_days: 2 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", component_ids: [], inventory_wbs_only: 1 },
  },
  {
    id: "B14", group: "B", title: "hammocks are excluded from the network: inventoried, never nodes, never anchor-resolved",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("H", { block_type: "hammock", duration_days: 0 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", component_ids: [], inventory_hammocks: 1 },
  },
  {
    id: "B15", group: "B", title: "block with neither lane nor WBS axis is an integrity finding, not a silent drop",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("X", { lane_ref: null, wbs_node_ref: null, duration_days: 1 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", integrity_kinds_include: ["BLOCK_NEITHER_AXIS"] },
  },
  {
    id: "B16", group: "B", title: "changing revisions across pages mark the snapshot PARTIAL with REVISION_UNATTESTED, never a silent coherent snapshot",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { pageSize: 1, mixedRevisions: true }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", coverage_gap_codes_include: ["REVISION_UNATTESTED"] },
  },
  {
    id: "B17", group: "B", title: "pagination is order-invariant: pageSize 1 yields the identical report to unpaged",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", report_equals_case: "A01" },
  },
  {
    id: "B18", group: "B", title: "stale collection (>15 min before as_of) marks the snapshot PARTIAL, never fresh",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: canonicalSpec(), clock: { nowIso: () => "2026-10-26T11:30:00.000Z" } }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL" },
  },
  {
    id: "B19", group: "B", title: "collection finished after as_of refuses SNAPSHOT_FROM_FUTURE outright",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: canonicalSpec(), clock: { nowIso: () => "2026-10-26T12:30:00.000Z" } }),
    expect: { outcome: "REFUSED", code: "SNAPSHOT_FROM_FUTURE" },
  },
  {
    id: "B20", group: "B", title: "missing category (dataset read fails) yields PARTIAL with a coverage gap, never an all-clear",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { failDataset: "schedule_dependencies" }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", diagnostics_include: "schedule_dependencies" },
  },
];

export { B };

// --- Group C: authority / prohibited data / operation / injection --
const C = [
  {
    id: "C01", group: "C", title: "DISABLED returns before any adapter, credential, store or source access (counters zero)",
    build: () => ({ host: hostWith({ mode: "DISABLED" }), request: requestWith(), spec: canonicalSpec() }),
    expect: { outcome: "DISABLED", counters_zero: true },
  },
  {
    id: "C02", group: "C", title: "live-shaped request (mode live) returns ACTIVATION_REQUIRED, never a read",
    build: () => ({ host: hostWith({ mode: "LIVE" }), request: requestWith(), spec: canonicalSpec() }),
    expect: { outcome: "ACTIVATION_REQUIRED" },
  },
  {
    id: "C03", group: "C", title: "production-shaped request (mode production) returns ACTIVATION_REQUIRED",
    build: () => ({ host: hostWith({ mode: "PRODUCTION" }), request: requestWith(), spec: canonicalSpec() }),
    expect: { outcome: "ACTIVATION_REQUIRED" },
  },
  {
    id: "C04", group: "C", title: "wrong principal refuses PRINCIPAL_MISMATCH before any read",
    build: () => ({ host: hostWith(), request: requestWith({ principal_ref: "principal-impostor" }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "PRINCIPAL_MISMATCH" },
  },
  {
    id: "C05", group: "C", title: "wrong owner refuses SCOPE_VIOLATION before any read",
    build: () => ({ host: hostWith(), request: requestWith({ owner_ref: "owner-2" }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION" },
  },
  {
    id: "C06", group: "C", title: "wrong scope TYPE with a coincidentally equal id refuses: a package id is not a scheduling project id",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "package", id: "P-1" } }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED" },
  },
  {
    id: "C07", group: "C", title: "unregistered project id refuses SCOPE_UNREGISTERED, never an empty population",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "scheduling-project", id: "P-2" } }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED" },
  },
  {
    id: "C08", group: "C", title: "caller-supplied adapter refuses CALLER_ADAPTER_REFUSED (no URL/path/query from callers)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec(), callerAdapter: { kind: "synthetic" } }),
    expect: { outcome: "REFUSED", code: "CALLER_ADAPTER_REFUSED" },
  },
  {
    id: "C09", group: "C", title: "mode smuggled inside the request refuses BAD_REQUEST (mode is host-owned only)",
    build: () => ({ host: hostWith(), request: requestWith({ mode: "live" }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST" },
  },
  {
    id: "C10", group: "C", title: "unknown job kind refuses UNKNOWN_AGENT",
    build: () => ({ host: hostWith(), request: requestWith({ job_kind: "tax-planning-review" }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "UNKNOWN_AGENT" },
  },
  {
    id: "C11", group: "C", title: "Project Controls kind in P2b-1 refuses JOB_NOT_BUILT_IN_SLICE (P2a-1 precedent for P2a-2)",
    build: () => ({ host: hostWith(), request: requestWith({ job_kind: "project-controls-evidence-review", window: { name: "planning-latest-through-asof" } }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "JOB_NOT_BUILT_IN_SLICE" },
  },
  {
    id: "C12", group: "C", title: "Project Manager kind in P2b-1 refuses JOB_NOT_BUILT_IN_SLICE",
    build: () => ({ host: hostWith(), request: requestWith({ job_kind: "project-manager-plan-health-review", window: { name: "planning-review-snapshot" } }), spec: canonicalSpec() }),
    expect: { outcome: "REFUSED", code: "JOB_NOT_BUILT_IN_SLICE" },
  },
  {
    id: "C13", group: "C", title: "cross-owner rows (leaky adapter) refuse SCOPE_VIOLATION in the builder's defense-in-depth",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks.push(block("X", { owner_ref: "owner-2" }));
      }), { leakyOwners: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION" },
  },
  {
    id: "C14", group: "C", title: "cross-scope rows (leaky adapter) refuse SCOPE_VIOLATION in the builder's defense-in-depth",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks.push(block("X", { project_ref: "P-9" }));
      }), { leakyScope: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION" },
  },
  {
    id: "C15", group: "C", title: "financial canary: cost fields on a row are dropped by the projection, never emitted/stored/logged",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        const row = block("A", { duration_days: 1 });
        row.cost_usd = 99999; row.pv = 1; row.ev = 2; row.cpi = 3;
        d.schedule_blocks = [row];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", forbidden_strings_absent: ["99999", "cost_usd"] },
  },
  {
    id: "C16", group: "C", title: "tenant/enrollment/contact canary: non-planning fields are dropped by the projection",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        const row = block("A", { duration_days: 1 });
        row.tenant_name = "CANARY-TENANT"; row.email = "canary@example.invalid"; row.phone = "555-0100";
        d.schedule_blocks = [row];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", forbidden_strings_absent: ["CANARY-TENANT", "canary@example.invalid", "555-0100"] },
  },
  {
    id: "C17", group: "C", title: "XSS string in source data is carried as inert data: row ids are digests, the item carries no markup",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, task_code: "<script>alert(1)</script>" })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", row_ids_digest_format: true },
  },
  {
    id: "C18", group: "C", title: "P670-005A counterexample: refs a:b, c, a, b:c collide under colon-join but get distinct digest row ids",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("a:b", { duration_days: 1 }), block("c", { duration_days: 1 }), block("a", { duration_days: 1 }), block("b:c", { duration_days: 1 })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "COMPLETED", distinct_row_ids: true },
  },
  {
    id: "C19", group: "C", title: "no side-effecting GET: adapter calls name only the 7 admitted datasets, never a project GET or mutation",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    expect: { outcome: "COMPLETED", adapter_datasets_only: true },
  },
  {
    id: "C20", group: "C", title: "permission revoked mid-read refuses PERMISSION_REVOKED and publishes nothing",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { revoked: true }) }),
    expect: { outcome: "REFUSED", code: "PERMISSION_REVOKED", published_count: 0 },
  },
];

export { C };

// --- Group D: budget / durability / replay / timeout ----------------
const D = [
  {
    id: "D01", group: "D", title: "candidate 65 refuses BUDGET_EXCEEDED with no domain totals",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = Array.from({ length: 60 }, (_, i) => block(`B${i}`, { duration_days: 1 }));
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "candidates", limit: 64, domain_totals_null: true },
  },
  {
    id: "D02", group: "D", title: "evidence-span cap 512 is enforced at unit level (unreachable in a full run: the 64-candidate cap fires first)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "span-cap-unit",
    expect: { outcome: "COMPLETED", post: { kind: "evidenceSpans", limit: 512 } },
  },
  {
    id: "D03", group: "D", title: "output-record cap 256 is enforced at unit level (unreachable in a full run: the 64-candidate cap fires first)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "output-cap-unit",
    expect: { outcome: "COMPLETED", post: { kind: "outputRecords", limit: 256 } },
  },
  {
    id: "D04", group: "D", title: "input bytes over 256 KiB refuse BUDGET_EXCEEDED during control admission",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1, task_code: "X".repeat(300 * 1024) })];
        d.schedule_dependencies = [];
      })) }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "inputBytes", limit: 262144 },
  },
  {
    id: "D05", group: "D", title: "control depth 33 refuses BUDGET_EXCEEDED (depth cap is 32)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: (() => {
        const deep = {}; let cur = deep;
        for (let i = 0; i < 33; i++) { cur.next = {}; cur = cur.next; }
        const s = canonicalSpec(); s.datasets = { ...s.datasets, schedule_blocks: [block("A", { duration_days: 1 })] };
        s.deep = deep;
        return s;
      })() }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "depth", limit: 32 },
  },
  {
    id: "D06", group: "D", title: "control depth exactly 32 is admitted: the run completes, proving the cap is 32 not lower",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: (() => {
        const deep = {}; let cur = deep;
        for (let i = 0; i < 30; i++) { cur.next = {}; cur = cur.next; }
        const s = canonicalSpec(); s.deep = deep;
        return s;
      })() }),
    expect: { outcome: "COMPLETED" },
  },
  {
    id: "D07", group: "D", title: "hung collection refuses EXECUTION_TIMEOUT preemptively (promise-only timeouts do not count)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { hangCollect: true }) }),
    expect: { outcome: "REFUSED", code: "EXECUTION_TIMEOUT" },
  },
  {
    id: "D08", group: "D", title: "synchronous runaway in the adapter refuses EXECUTION_TIMEOUT via worker termination",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { syncSpinMs: 30000 }) }),
    expect: { outcome: "REFUSED", code: "EXECUTION_TIMEOUT" },
  },
  {
    id: "D09", group: "D", title: "slow-but-bounded reads complete: the deadline is 5 s, not zero",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { slowReadMs: 100 }) }),
    expect: { outcome: "COMPLETED" },
  },
  {
    id: "D10", group: "D", title: "replay of identical content is idempotent: first run writes, second and third write nothing",
    build: () => {
      const datasets = clone(CANONICAL_PROJECT);
      const rename = (o) => { if (o && typeof o === "object") { for (const k of Object.keys(o)) { if (k === "project_ref" && o[k] === "P-1") o[k] = "P-10"; if (k === "project_scope_ref") continue; rename(o[k]); } } };
      rename(datasets);
      return {
        host: hostWith({ registered_project_scope: { type: "scheduling-project", id: "P-10" } }),
        request: requestWith({ project_scope_ref: { type: "scheduling-project", id: "P-10" }, snapshot_request_id: "snap-d10-1" }),
        spec: specWith(datasets),
      };
    },
    expect: { outcome: "COMPLETED", replay_idempotent: true },
  },
  {
    id: "D11", group: "D", title: "replay with changed content under the same identity refuses REPUBLISH_CONFLICT (changed content gets its own version)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "republish-conflict",
    expect: { outcome: "COMPLETED", post: { code: "REPUBLISH_CONFLICT" } },
  },
  {
    id: "D12", group: "D", title: "hanging publisher refuses PUBLICATION_TIMEOUT; the report was computed but not durably published",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec(), hangingPublisher: true }),
    expect: { outcome: "REFUSED", code: "PUBLICATION_TIMEOUT" },
  },
  {
    id: "D13", group: "D", title: "looping cursor refuses cleanly: CURSOR_FAULT marks the dataset partial, no infinite loop",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { cursorLoopDataset: "schedule_blocks" }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", collection_error_codes_include: ["CURSOR_FAULT"] },
  },
  {
    id: "D14", group: "D", title: "stale decision digest refuses STALE_DIGEST: a refreshed report never inherits an old decision",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "decide-stale",
    expect: { outcome: "COMPLETED", post: { code: "STALE_DIGEST" } },
  },
  {
    id: "D15", group: "D", title: "decision on an unknown row refuses UNKNOWN_ROW",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "decide-unknown-row",
    expect: { outcome: "COMPLETED", post: { code: "UNKNOWN_ROW" } },
  },
  {
    id: "D16", group: "D", title: "decision outside the closed enum refuses BAD_DECISION (no Approve/Apply/Execute/Send/Auto-fix/Activate)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "decide-bad-enum",
    expect: { outcome: "COMPLETED", post: { code: "BAD_DECISION" } },
  },
  {
    id: "D17", group: "D", title: "trust root mismatch refuses before any candidate byte runs",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "trust-wrong-root",
    expect: { outcome: "COMPLETED", post: { refused: true } },
  },
  {
    id: "D18", group: "D", title: "unlisted entry refuses (exit 3): a test file on disk but absent from the manifest never runs",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "trust-unlisted-entry",
    expect: { outcome: "COMPLETED", post: { exit: 3 } },
  },
  {
    id: "D19", group: "D", title: "deadline already spent refuses EXECUTION_TIMEOUT before the worker spawns",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalSpec() }),
    post: "deadline-spent",
    expect: { outcome: "COMPLETED", post: { code: "EXECUTION_TIMEOUT" } },
  },
  {
    id: "D20", group: "D", title: "duplicate conflicting rows mark the snapshot PARTIAL with DUPLICATE_CONFLICT, never an all-clear",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = [block("A", { duration_days: 1 }), block("A", { duration_days: 2 })];
        d.schedule_dependencies = [];
      }), { pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", conflicts_include: ["DUPLICATE_CONFLICT"] },
  },
];

export { D };

export const CASES = [...A, ...B, ...C, ...D];
