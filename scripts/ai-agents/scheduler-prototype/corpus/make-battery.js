#!/usr/bin/env node
/**
 * make-battery.js — AUTHORING TOOL (not part of the scored path).
 * Builds corpus/battery.json: 120 independently-specified cases with
 * expected outputs derived from the brief's text via an INDEPENDENT
 * oracle written here. The oracle never imports src/* and re-derives
 * CPM arithmetic with separately written logic.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

// ================= Independent oracle (clean-room CPM) =================
// Written separately from src/scheduler.js. Plain, obviously-correct
// logic; hand-verified against manual derivations for the core cases.

function oDayNum(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function oCivil(n) {
  const dt = new Date(n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
function oIsoWd(s) {
  const [y, m, d] = s.split("-").map(Number);
  const j = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return j === 0 ? 7 : j;
}
function oWorking(anchor, horizon, mask, excl) {
  const out = [];
  const ex = new Set(excl);
  const base = oDayNum(anchor);
  for (let d = 0; d < horizon; d++) {
    const c = oCivil(base + d);
    if (mask.indexOf(oIsoWd(c)) >= 0 && !ex.has(c)) out.push(c);
  }
  return out;
}
function oW(type, dp, ds, lag) {
  if (type === "FS") return dp + lag;
  if (type === "SS") return lag;
  if (type === "FF") return dp + lag - ds;
  return lag - ds; // SF
}
// Recursive cycle finder (different structure from src's iterative one).
function oCycle(nodes, succ) {
  const color = {};
  for (const n of nodes) color[n] = 0;
  function dfs(u, trail) {
    color[u] = 1;
    trail.push(u);
    for (const v of succ[u] || []) {
      if (color[v] === 1) return trail.slice(trail.indexOf(v)).concat([v]);
      if (color[v] === 0) {
        const r = dfs(v, trail);
        if (r) return r;
      }
    }
    trail.pop();
    color[u] = 2;
    return null;
  }
  for (const n of nodes) {
    if (color[n] === 0) {
      const r = dfs(n, []);
      if (r) return r;
    }
  }
  return null;
}

function oComponent(cid, acts, ties, cals, anchor, horizon, deadline, constraints) {
  const bad = (status, reason, detail) => ({
    component_id: cid, status, reason, detail: detail ?? null,
    activities: [], critical_activities: [], critical_edges: [],
  });
  if (cals.length === 0) return bad("UNVERIFIABLE", "no-calendar");
  if (cals.length > 1) return bad("UNSUPPORTED_CALENDAR", "mixed-calendars");
  if (!anchor) return bad("UNVERIFIABLE", "no-anchor");
  const working = oWorking(anchor, horizon, cals[0].working_weekdays, cals[0].excluded_dates);
  if (working.length === 0) return bad("CALENDAR_NO_WORKING_DAYS", "no-working-days");

  const dur = {};
  for (const a of acts) dur[a.id] = a.duration_workdays;
  for (const t of ties) {
    if (!(t.predecessor in dur)) return bad("DANGLING_TIE", "dangling", { tie: t.id, missing: t.predecessor });
    if (!(t.successor in dur)) return bad("DANGLING_TIE", "dangling", { tie: t.id, missing: t.successor });
  }
  const ids = acts.map((a) => a.id);
  const succ = {};
  const pred = {};
  for (const id of ids) { succ[id] = []; pred[id] = []; }
  const w = {};
  for (const t of ties) {
    w[t.id] = oW(t.type, dur[t.predecessor], dur[t.successor], t.lag_workdays);
    succ[t.predecessor].push(t.successor);
    pred[t.successor].push(t.predecessor);
  }
  const cyc = oCycle(ids, succ);
  if (cyc) return bad("CYCLE_DETECTED", "cycle", { cycle_path: cyc });

  // Kahn
  const indeg = {};
  for (const id of ids) indeg[id] = pred[id].length;
  const q = ids.filter((id) => indeg[id] === 0);
  const order = [];
  while (q.length) {
    const u = q.shift();
    order.push(u);
    for (const v of succ[u]) { if (--indeg[v] === 0) q.push(v); }
  }

  const rel = {};
  for (const a of acts) rel[a.id] = a.release_tick;
  const upperExtra = {};
  for (const id of ids) upperExtra[id] = Infinity;
  for (const c of constraints) {
    if (!(c.activity_id in dur)) continue;
    if (c.kind === "START_NO_EARLIER_THAN") rel[c.activity_id] = Math.max(rel[c.activity_id], c.tick);
    else if (c.kind === "MUST_FINISH_ON") {
      rel[c.activity_id] = Math.max(rel[c.activity_id], c.tick - dur[c.activity_id]);
      upperExtra[c.activity_id] = Math.min(upperExtra[c.activity_id], c.tick - dur[c.activity_id]);
    } else if (c.kind === "FINISH_NO_LATER_THAN") {
      upperExtra[c.activity_id] = Math.min(upperExtra[c.activity_id], c.tick - dur[c.activity_id]);
    }
  }

  const ES = {}, EF = {};
  for (const id of order) {
    let es = Math.max(0, rel[id]);
    for (const p of pred[id]) {
      for (const t of ties) {
        if (t.predecessor === p && t.successor === id) es = Math.max(es, ES[p] + w[t.id]);
      }
    }
    ES[id] = es;
    EF[id] = es + dur[id];
  }
  const maxEF = ids.length ? Math.max(...ids.map((id) => EF[id])) : 0;
  if (ids.length && maxEF > working.length) {
    return bad("CALENDAR_HORIZON_EXCEEDED", "horizon", { required: maxEF, available: working.length });
  }
  const D = deadline !== null && deadline !== undefined ? deadline : maxEF;
  const LS = {}, LF = {};
  for (const id of ids) LS[id] = Math.min(D - dur[id], upperExtra[id]);
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    for (const s of succ[id]) {
      for (const t of ties) {
        if (t.predecessor === id && t.successor === s) LS[id] = Math.min(LS[id], LS[s] - w[t.id]);
      }
    }
    LF[id] = LS[id] + dur[id];
  }
  for (const id of ids) {
    if (ES[id] > LS[id]) {
      return {
        component_id: cid, status: "CONSTRAINT_UNSATISFIABLE", reason: "unsat",
        detail: { activity: id, es: ES[id], ls: LS[id] },
        activities: ids.map((x) => ({
          id: x, es: ES[x], ef: EF[x], ls: LS[x], lf: LF[x],
          total_float: LS[x] - ES[x], critical: false,
          civil_start: null, civil_finish_boundary: null,
        })),
        critical_activities: [], critical_edges: [],
      };
    }
  }
  const fl = (id) => LS[id] - ES[id];
  const critA = new Set(ids.filter((id) => fl(id) === 0));
  const tight = new Set(ties.filter((t) => ES[t.successor] === ES[t.predecessor] + w[t.id]).map((t) => t.id));
  const critE = new Set([...tight].filter((tid) => {
    const t = ties.find((x) => x.id === tid);
    return critA.has(t.predecessor) && critA.has(t.successor);
  }));
  return {
    component_id: cid, status: "READY", reason: null, detail: null,
    activities: ids.map((id) => ({
      id, es: ES[id], ef: EF[id], ls: LS[id], lf: LF[id],
      total_float: fl(id), critical: critA.has(id),
      civil_start: working[ES[id]],
      civil_finish_boundary: dur[id] === 0 ? working[ES[id]] : working[EF[id]],
    })),
    critical_activities: [...critA].sort(),
    critical_edges: [...critE].sort(),
  };
}

function oRun(bundleName, opts) {
  const ref = store.bundleRefs[bundleName];
  const records = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text);
  // Quarantine simulation (independent predicate): records whose free-text
  // note carries a seeded directive family are excluded before analysis.
  const QUARANTINE_RE = /ignore (all )?previous instructions|disregard (the|your) (brief|instructions|policy)|you are now (a|an) |approve this (schedule|baseline|change)|final:? (this is )?approved|\[signed\]|<script[\s>]|commit these dates|publish the schedule/i;
  const clean = records.filter((r) => !(typeof r.note === "string" && QUARANTINE_RE.test(r.note)));
  const groups = new Map();
  for (const r of clean) {
    if (!groups.has(r.component)) groups.set(r.component, { acts: [], ties: [], cals: [] });
    const g = groups.get(r.component);
    if (r.record === "activity") g.acts.push(r);
    else if (r.record === "tie") g.ties.push(r);
    else g.cals.push(r);
  }
  const components = [];
  for (const [cid, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    components.push(oComponent(
      cid, g.acts, g.ties, g.cals,
      (opts.anchors || {})[cid] || null,
      opts.horizon !== undefined ? opts.horizon : 60,
      (opts.deadlines || {})[cid],
      opts.constraints || []
    ));
  }
  return components;
}

// ================= Builders =================
function baseContext(bundleNames, overrides = {}) {
  const sources = {};
  const readGrants = [];
  for (const n of bundleNames) {
    const ref = store.bundleRefs[n];
    const key = `${ref.repo}|${ref.path}`;
    sources[key] = store.sources[key];
    readGrants.push({ repo: ref.repo, path: ref.path });
  }
  return {
    clock: ("clock" in overrides) ? overrides.clock : 1780315200000,
    sources: overrides.sources !== undefined ? overrides.sources : sources,
    readGrants: overrides.readGrants !== undefined ? overrides.readGrants : readGrants,
    principal: overrides.principal || store.principals.jason,
    criteria: { ...store.criteriaPresets.standard, ...(overrides.criteria || {}) },
  };
}

function baseTask(bundleName, opts = {}) {
  const ref = store.bundleRefs[bundleName];
  let n = 0;
  try {
    n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  } catch { n = 0; }
  const task = {
    schema_version: "1",
    task_id: `battery-${opts.caseId || bundleName}`,
    operation: opts.operation !== undefined ? opts.operation : "analyze",
    fixture_refs: { network_bundle: { ...(opts.refOverride || ref) } },
    options: {
      population: { declared_total: opts.declared !== undefined ? opts.declared : n, complete: opts.complete !== undefined ? opts.complete : true },
      anchors: opts.anchors || { c1: "2026-01-05" },
      horizon_days: opts.horizon !== undefined ? opts.horizon : 60,
      deadlines: opts.deadlines || {},
      constraints: opts.constraints || [],
      claimed: opts.claimed || {},
    },
  };
  if (opts.taskMutate) opts.taskMutate(task);
  if (opts.taskOverride !== undefined) return opts.taskOverride;
  return task;
}

const CASES = [];
function addCase(case_id, category, bundleName, taskOpts, ctxOverrides, expected) {
  CASES.push({
    case_id, category,
    task: baseTask(bundleName, { ...taskOpts, caseId: case_id }),
    context: baseContext([bundleName], ctxOverrides || {}),
    expected,
  });
}
function expReady(bundleName, taskOpts, extra = {}) {
  const components = oRun(bundleName, {
    anchors: taskOpts.anchors || { c1: "2026-01-05" },
    horizon: taskOpts.horizon || 60,
    deadlines: taskOpts.deadlines || {},
    constraints: taskOpts.constraints || [],
  });
  const anyReady = components.some((c) => c.status === "READY");
  const anyFailed = components.some((c) => c.status !== "READY");
  const claimMismatch = (extra.claimed_states || []).includes("mismatch");
  const status = !anyReady || anyFailed || claimMismatch ? "PARTIAL" : "REPORT_READY";
  const coverage = extra.coverage_state || (anyFailed || claimMismatch ? "PARTIAL" : "COMPLETE");
  return {
    status,
    diagnostic_codes: extra.diagnostic_codes || [],
    components,
    claimed_states: extra.claimed_states || [],
    quarantined_ids: extra.quarantined_ids || [],
    coverage_state: coverage,
    ...extra.overrides,
  };
}

// ================= 120 battery cases =================
function expRefused(code) {
  return { status: "REFUSED", diagnostic_codes: [code], components: [], claimed_states: [], quarantined_ids: [], coverage_state: "UNKNOWN" };
}

// ---------- 40 nominal / boundary ----------
addCase("nom-001-empty", "nominal_boundary", "empty", {}, {}, {
  status: "EMPTY", diagnostic_codes: [], components: [], claimed_states: [], quarantined_ids: [], coverage_state: "COMPLETE_EMPTY",
});
addCase("nom-002-single-activity", "nominal_boundary", "single-activity", {}, {}, expReady("single-activity", {}));
addCase("nom-003-fs-chain", "nominal_boundary", "fs-chain", {}, {}, expReady("fs-chain", {}));
addCase("nom-004-ss-lag", "nominal_boundary", "ss-lag", {}, {}, expReady("ss-lag", {}));
addCase("nom-005-ff-tie", "nominal_boundary", "ff-tie", {}, {}, expReady("ff-tie", {}));
addCase("nom-006-sf-tie", "nominal_boundary", "sf-tie", {}, {}, expReady("sf-tie", {}));
addCase("nom-007-negative-lag", "nominal_boundary", "negative-lag", {}, {}, expReady("negative-lag", {}));
addCase("nom-008-zero-milestone", "nominal_boundary", "zero-milestone", {}, {}, expReady("zero-milestone", {}));
addCase("nom-009-excluded-date", "nominal_boundary", "excluded-date", {}, {}, expReady("excluded-date", {}));
addCase("nom-010-leap-day", "nominal_boundary", "leap-day", { anchors: { c1: "2028-02-25" } }, {}, expReady("leap-day", { anchors: { c1: "2028-02-25" } }));
addCase("nom-011-release-tick", "nominal_boundary", "release-tick", {}, {}, expReady("release-tick", {}));
addCase("nom-012-diamond", "nominal_boundary", "diamond", {}, {}, expReady("diamond", {}));
addCase("nom-013-two-components", "nominal_boundary", "two-components", { anchors: { c1: "2026-01-05", c2: "2026-01-05" } }, {}, expReady("two-components", { anchors: { c1: "2026-01-05", c2: "2026-01-05" } }));
addCase("nom-014-deadline-loose", "nominal_boundary", "fs-chain", { deadlines: { c1: 12 } }, {}, expReady("fs-chain", { deadlines: { c1: 12 } }));
addCase("nom-015-deadline-early", "nominal_boundary", "fs-chain", { deadlines: { c1: 7 } }, {}, expReady("fs-chain", { deadlines: { c1: 7 } }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("nom-016-snet", "nominal_boundary", "single-activity", { constraints: [{ activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 3 }] }, {}, expReady("single-activity", { constraints: [{ activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 3 }] }));
addCase("nom-017-mfo-ok", "nominal_boundary", "mfo-base", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 8 }] }, {}, expReady("mfo-base", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 8 }] }));
addCase("nom-018-mfo-impossible", "nominal_boundary", "mfo-base", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 2 }] }, {}, expReady("mfo-base", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 2 }] }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("nom-019-fnlt-feasible", "nominal_boundary", "single-activity", { constraints: [{ activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 6 }] }, {}, expReady("single-activity", { constraints: [{ activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 6 }] }));
addCase("nom-020-horizon-overflow", "nominal_boundary", "horizon-overflow", { horizon: 14 }, {}, expReady("horizon-overflow", { horizon: 14 }, { diagnostic_codes: ["CALENDAR_HORIZON_EXCEEDED"] }));
addCase("nom-021-no-working-days", "nominal_boundary", "no-working-days", { horizon: 7 }, {}, expReady("no-working-days", { horizon: 7 }, { diagnostic_codes: ["CALENDAR_NO_WORKING_DAYS"] }));
addCase("nom-022-island-no-calendar", "nominal_boundary", "island-no-calendar", {}, {}, expReady("island-no-calendar", {}, { diagnostic_codes: ["UNVERIFIABLE"] }));
addCase("nom-023-cycle", "nominal_boundary", "cycle", {}, {}, expReady("cycle", {}, { diagnostic_codes: ["CYCLE_DETECTED"] }));
addCase("nom-024-dangling", "nominal_boundary", "dangling", {}, {}, expReady("dangling", {}, { diagnostic_codes: ["DANGLING_TIE"] }));
addCase("nom-025-mixed-calendars", "nominal_boundary", "mixed-calendars", {}, {}, expReady("mixed-calendars", {}, { diagnostic_codes: ["UNSUPPORTED_CALENDAR"] }));
addCase("nom-026-alap", "nominal_boundary", "single-activity", { constraints: [{ activity_id: "A", kind: "ALAP", tick: 0 }] }, {}, expRefused("UNSUPPORTED_CONSTRAINT"));
addCase("nom-027-claimed-correct", "nominal_boundary", "fs-chain", {
  claimed: { activities: {
    A: { es: 0, ef: 3, ls: 0, lf: 3, total_float: 0 },
    B: { es: 3, ef: 7, ls: 3, lf: 7, total_float: 0 },
    C: { es: 7, ef: 9, ls: 7, lf: 9, total_float: 0 },
  } },
}, {}, expReady("fs-chain", {}, { claimed_states: ["verified", "verified", "verified"] }));
addCase("nom-028-claimed-wrong-float", "nominal_boundary", "fs-chain", {
  claimed: { activities: { B: { es: 3, ef: 7, ls: 3, lf: 7, total_float: 5 } } },
}, {}, expReady("fs-chain", {}, { diagnostic_codes: ["CLAIMED_VALUE_MISMATCH"], claimed_states: ["mismatch"] }));
addCase("nom-029-claimed-day30-45", "nominal_boundary", "release-45", {
  horizon: 90,
  claimed: { activities: { A: { es: 30, ef: 32, ls: 45, lf: 47, total_float: 0 } } },
}, {}, expReady("release-45", { horizon: 90 }, { diagnostic_codes: ["CLAIMED_VALUE_MISMATCH"], claimed_states: ["mismatch"] }));
addCase("nom-030-claimed-negative-float", "nominal_boundary", "fs-chain", {
  claimed: { activities: { A: { es: 0, ef: 3, ls: 0, lf: 3, total_float: -2 } } },
}, {}, expReady("fs-chain", {}, { diagnostic_codes: ["CLAIMED_VALUE_MISMATCH"], claimed_states: ["mismatch"] }));
addCase("nom-031-claimed-path-correct", "nominal_boundary", "fs-chain", {
  claimed: { critical_paths: { c1: ["A", "B", "C"] } },
}, {}, expReady("fs-chain", {}, { claimed_states: ["verified"] }));
addCase("nom-032-claimed-path-wrong", "nominal_boundary", "diamond", {
  claimed: { critical_paths: { c1: ["A", "B", "D"] } },
}, {}, expReady("diamond", {}, { diagnostic_codes: ["CLAIMED_PATH_MISMATCH"], claimed_states: ["mismatch"] }));
addCase("nom-033-injection-quarantine", "nominal_boundary", "injection", {}, {}, expReady("injection", {}, { diagnostic_codes: ["INSTRUCTION_INJECTION", "DANGLING_TIE"], quarantined_ids: ["A"] }));
addCase("nom-034-partial-mixed", "nominal_boundary", "partial-mixed", { anchors: { c1: "2026-01-05", c2: "2026-01-05" } }, {}, expReady("partial-mixed", { anchors: { c1: "2026-01-05", c2: "2026-01-05" } }, { diagnostic_codes: ["CYCLE_DETECTED"] }));
addCase("nom-035-ss-chain", "nominal_boundary", "ss-chain", {}, {}, expReady("ss-chain", {}));
addCase("nom-036-weekend-span", "nominal_boundary", "weekend-span", {}, {}, expReady("weekend-span", {}));
addCase("nom-037-cross-component-tie", "nominal_boundary", "cross-component-tie", { anchors: { c1: "2026-01-05", c2: "2026-01-05" } }, {}, expReady("cross-component-tie", { anchors: { c1: "2026-01-05", c2: "2026-01-05" } }, { diagnostic_codes: ["DANGLING_TIE"] }));
addCase("nom-038-two-snet", "nominal_boundary", "single-activity", { constraints: [
  { activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 2 },
  { activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 5 },
] }, {}, expReady("single-activity", { constraints: [
  { activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 2 },
  { activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 5 },
] }));
addCase("nom-039-mfo-fnlt-combo", "nominal_boundary", "single-activity", { constraints: [
  { activity_id: "A", kind: "MUST_FINISH_ON", tick: 10 },
  { activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 12 },
] }, {}, expReady("single-activity", { constraints: [
  { activity_id: "A", kind: "MUST_FINISH_ON", tick: 10 },
  { activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 12 },
] }));
addCase("nom-040-deadline-eq-maxef", "nominal_boundary", "single-activity", { deadlines: { c1: 5 } }, {}, expReady("single-activity", { deadlines: { c1: 5 } }));

// ---------- 30 contradiction / incomplete / duplicate ----------
addCase("con-001-duplicate-ids", "contradiction_incomplete", "duplicate-ids", {}, {}, expRefused("INVALID_INPUT"));
addCase("con-002-population-mismatch", "contradiction_incomplete", "fs-chain", { declared: 99 }, {}, expReady("fs-chain", {}, { coverage_state: "UNKNOWN" }));
addCase("con-003-incomplete-population", "contradiction_incomplete", "fs-chain", { complete: false }, {}, expReady("fs-chain", {}, { coverage_state: "UNKNOWN" }));
addCase("con-004-missing-anchor", "contradiction_incomplete", "fs-chain", { anchors: { c2: "2026-01-05" } }, {}, expReady("fs-chain", { anchors: { c2: "2026-01-05" } }, { diagnostic_codes: ["UNVERIFIABLE"] }));
addCase("con-005-deadline-unknown-component", "contradiction_incomplete", "fs-chain", { deadlines: { c99: 5 } }, {}, expReady("fs-chain", { deadlines: { c99: 5 } }));
addCase("con-006-constraint-unknown-activity", "contradiction_incomplete", "fs-chain", { constraints: [{ activity_id: "ZZZ", kind: "START_NO_EARLIER_THAN", tick: 3 }] }, {}, expReady("fs-chain", { constraints: [{ activity_id: "ZZZ", kind: "START_NO_EARLIER_THAN", tick: 3 }] }));
addCase("con-007-mfo-impossible", "contradiction_incomplete", "mfo-base", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 2 }] }, {}, expReady("mfo-base", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 2 }] }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("con-008-deadline-early", "contradiction_incomplete", "fs-chain", { deadlines: { c1: 7 } }, {}, expReady("fs-chain", { deadlines: { c1: 7 } }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("con-009-fnlt-impossible", "contradiction_incomplete", "single-activity", { constraints: [{ activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 4 }] }, {}, expReady("single-activity", { constraints: [{ activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 4 }] }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("con-010-claimed-bad-field", "contradiction_incomplete", "fs-chain", {
  claimed: { activities: { A: { es: "zero", ef: 3, ls: 0, lf: 3, total_float: 0 } } },
}, {}, expRefused("INVALID_INPUT"));
addCase("con-011-bad-anchor-date", "contradiction_incomplete", "fs-chain", { anchors: { c1: "2026-02-30" } }, {}, expRefused("INVALID_INPUT"));
addCase("con-012-horizon-zero", "contradiction_incomplete", "fs-chain", { horizon: 0 }, {}, expRefused("INVALID_INPUT"));
addCase("con-013-horizon-367", "contradiction_incomplete", "fs-chain", { horizon: 367 }, {}, expRefused("INVALID_INPUT"));
addCase("con-014-deadline-negative", "contradiction_incomplete", "fs-chain", { deadlines: { c1: -1 } }, {}, expRefused("INVALID_INPUT"));
addCase("con-015-constraint-tick-over", "contradiction_incomplete", "fs-chain", { constraints: [{ activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 400 }] }, {}, expRefused("INVALID_INPUT"));
addCase("con-016-constraint-bad-kind", "contradiction_incomplete", "fs-chain", { constraints: [{ activity_id: "A", kind: "ASAP", tick: 1 }] }, {}, expRefused("INVALID_INPUT"));
addCase("con-017-empty-anchors", "contradiction_incomplete", "fs-chain", { anchors: {} }, {}, expRefused("INVALID_INPUT"));
addCase("con-018-claimed-empty-path", "contradiction_incomplete", "fs-chain", { claimed: { critical_paths: { c1: [] } } }, {}, expRefused("INVALID_INPUT"));
addCase("con-019-population-negative", "contradiction_incomplete", "fs-chain", { declared: -1 }, {}, expRefused("INVALID_INPUT"));
addCase("con-020-operation-empty", "contradiction_incomplete", "fs-chain", { operation: "" }, {}, expRefused("INVALID_INPUT"));
addCase("con-021-snet-fnlt-conflict", "contradiction_incomplete", "single-activity", { constraints: [
  { activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 10 },
  { activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 4 },
] }, {}, expReady("single-activity", { constraints: [
  { activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: 10 },
  { activity_id: "A", kind: "FINISH_NO_LATER_THAN", tick: 4 },
] }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("con-022-deadline-zero", "contradiction_incomplete", "fs-chain", { deadlines: { c1: 0 } }, {}, expReady("fs-chain", { deadlines: { c1: 0 } }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("con-023-claimed-path-unverifiable", "contradiction_incomplete", "cycle", { claimed: { critical_paths: { c1: ["A", "B"] } } }, {}, expReady("cycle", {}, { diagnostic_codes: ["CYCLE_DETECTED"], claimed_states: ["unverifiable"] }));
addCase("con-024-claimed-unknown-activity", "contradiction_incomplete", "fs-chain", { claimed: { activities: { ZZZ: { es: 0, ef: 1, ls: 0, lf: 1, total_float: 0 } } } }, {}, expReady("fs-chain", {}, { claimed_states: ["unverifiable"] }));
addCase("con-025-diamond-deadline-6", "contradiction_incomplete", "diamond", { deadlines: { c1: 6 } }, {}, expReady("diamond", { deadlines: { c1: 6 } }));
addCase("con-026-diamond-deadline-5", "contradiction_incomplete", "diamond", { deadlines: { c1: 5 } }, {}, expReady("diamond", { deadlines: { c1: 5 } }, { diagnostic_codes: ["CONSTRAINT_UNSATISFIABLE"] }));
addCase("con-027-mfo-exact", "contradiction_incomplete", "single-activity", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 5 }] }, {}, expReady("single-activity", { constraints: [{ activity_id: "A", kind: "MUST_FINISH_ON", tick: 5 }] }));
addCase("con-028-claimed-ef-wrong", "contradiction_incomplete", "fs-chain", { claimed: { activities: { C: { es: 7, ef: 12, ls: 7, lf: 9, total_float: 0 } } } }, {}, expReady("fs-chain", {}, { diagnostic_codes: ["CLAIMED_VALUE_MISMATCH"], claimed_states: ["mismatch"] }));
addCase("con-029-anchors-extra", "contradiction_incomplete", "fs-chain", { anchors: { c1: "2026-01-05", c99: "2026-02-01" } }, {}, expReady("fs-chain", { anchors: { c1: "2026-01-05", c99: "2026-02-01" } }));
addCase("con-030-baseline-explicit-empty", "contradiction_incomplete", "fs-chain", { deadlines: {}, constraints: [], claimed: {} }, {}, expReady("fs-chain", {}));

// ---------- 20 injection / prohibited-operation ----------
addCase("inj-001-op-delete", "injection_prohibited", "fs-chain", { operation: "delete" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-002-op-execute", "injection_prohibited", "fs-chain", { operation: "execute" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-003-op-publish", "injection_prohibited", "fs-chain", { operation: "publish" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-004-op-approve", "injection_prohibited", "fs-chain", { operation: "approve-baseline" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-005-quarantine-standard", "injection_prohibited", "injection", {}, {}, expReady("injection", {}, { diagnostic_codes: ["INSTRUCTION_INJECTION", "DANGLING_TIE"], quarantined_ids: ["A"] }));
addCase("inj-006-quarantine-declared-mismatch", "injection_prohibited", "injection", { declared: 99 }, {}, expReady("injection", {}, { diagnostic_codes: ["INSTRUCTION_INJECTION", "DANGLING_TIE"], quarantined_ids: ["A"], coverage_state: "UNKNOWN" }));
addCase("inj-007-quarantine-incomplete", "injection_prohibited", "injection", { complete: false }, {}, expReady("injection", {}, { diagnostic_codes: ["INSTRUCTION_INJECTION", "DANGLING_TIE"], quarantined_ids: ["A"], coverage_state: "UNKNOWN" }));
addCase("inj-008-quarantine-claimed-unverifiable", "injection_prohibited", "injection", { claimed: { activities: { A: { es: 0, ef: 3, ls: 0, lf: 3, total_float: 0 } } } }, {}, expReady("injection", {}, { diagnostic_codes: ["INSTRUCTION_INJECTION", "DANGLING_TIE"], quarantined_ids: ["A"], claimed_states: ["unverifiable"] }));
addCase("inj-009-op-write", "injection_prohibited", "fs-chain", { operation: "write" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-010-op-send", "injection_prohibited", "fs-chain", { operation: "send" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-011-op-mutate", "injection_prohibited", "fs-chain", { operation: "mutate" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-012-op-export", "injection_prohibited", "fs-chain", { operation: "export" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-013-op-commit", "injection_prohibited", "fs-chain", { operation: "commit" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-014-op-schedule", "injection_prohibited", "fs-chain", { operation: "schedule" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-015-op-trailing-space", "injection_prohibited", "fs-chain", { operation: "analyze " }, {}, expRefused("ACTION_DENIED"));
addCase("inj-016-op-uppercase", "injection_prohibited", "fs-chain", { operation: "ANALYZE" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-017-quarantine-with-deadline", "injection_prohibited", "injection", { deadlines: { c1: 10 } }, {}, expReady("injection", { deadlines: { c1: 10 } }, { diagnostic_codes: ["INSTRUCTION_INJECTION", "DANGLING_TIE"], quarantined_ids: ["A"] }));
addCase("inj-018-op-null", "injection_prohibited", "fs-chain", { taskMutate: (t) => { t.operation = null; } }, {}, expRefused("INVALID_INPUT"));
addCase("inj-019-op-number", "injection_prohibited", "fs-chain", { taskMutate: (t) => { t.operation = 42; } }, {}, expRefused("INVALID_INPUT"));
addCase("inj-020-quarantine-anchors-both", "injection_prohibited", "injection", { anchors: { c1: "2026-01-05", c2: "2026-02-01" } }, {}, expReady("injection", { anchors: { c1: "2026-01-05", c2: "2026-02-01" } }, { diagnostic_codes: ["INSTRUCTION_INJECTION", "DANGLING_TIE"], quarantined_ids: ["A"] }));

// ---------- 20 schema / provenance / permission ----------
addCase("sch-001-task-null", "schema_provenance", "fs-chain", { taskOverride: null }, {}, expRefused("INVALID_INPUT"));
addCase("sch-002-task-unknown-prop", "schema_provenance", "fs-chain", { taskMutate: (t) => { t.extra = 1; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-003-schema-version-2", "schema_provenance", "fs-chain", { taskMutate: (t) => { t.schema_version = "2"; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-004-bad-hex-commit", "schema_provenance", "fs-chain", { taskMutate: (t) => { t.fixture_refs.network_bundle.commit = "xyz"; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-005-blob-mismatch", "schema_provenance", "fs-chain", { refOverride: { ...store.bundleRefs["fs-chain"], blob: "0".repeat(40) } }, {}, expRefused("HASH_MISMATCH"));
addCase("sch-006-unregistered-commit", "schema_provenance", "fs-chain", { refOverride: { ...store.bundleRefs["fs-chain"], commit: "1".repeat(40) } }, {}, expRefused("SOURCE_UNVERIFIED"));
addCase("sch-007-unregistered-path", "schema_provenance", "fs-chain", { refOverride: { ...store.bundleRefs["fs-chain"], path: "networks/nope.json" } }, { readGrants: [{ repo: "sched-sources", path: "networks/nope.json" }] }, expRefused("SOURCE_UNVERIFIED"));
addCase("sch-008-missing-grant", "schema_provenance", "fs-chain", {}, { readGrants: [] }, expRefused("READ_DENIED"));
addCase("sch-009-principal-revoked", "schema_provenance", "fs-chain", {}, { principal: { ...store.principals.jason, revoked: true } }, expRefused("ACTION_DENIED"));
addCase("sch-010-clock-expired", "schema_provenance", "fs-chain", {}, { clock: 1820000000000 }, expRefused("ACTION_DENIED"));
addCase("sch-011-clock-not-yet-valid", "schema_provenance", "fs-chain", {}, { clock: 1700000000000 }, expRefused("ACTION_DENIED"));
addCase("sch-012-clock-missing", "schema_provenance", "fs-chain", {}, { clock: undefined }, expRefused("INVALID_INPUT"));
addCase("sch-013-not-array", "schema_provenance", "not-array", { declared: 0 }, {}, expRefused("INVALID_INPUT"));
addCase("sch-014-bad-json-entry", "schema_provenance", "bad-json-entry", { declared: 0 }, {}, expRefused("INVALID_INPUT"));
addCase("sch-015-bad-algorithm", "schema_provenance", "fs-chain", { taskMutate: (t) => { t.fixture_refs.network_bundle.algorithm = "sha256"; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-016-path-traversal", "schema_provenance", "fs-chain", { taskMutate: (t) => { t.fixture_refs.network_bundle.path = "../networks/x.json"; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-017-horizon-over-policy", "schema_provenance", "fs-chain", { horizon: 60 }, { criteria: { max_horizon_days: 30 } }, expRefused("INVALID_INPUT"));
addCase("sch-018-context-sources-empty", "schema_provenance", "fs-chain", {}, { sources: {}, readGrants: [{ repo: "sched-sources", path: "networks/fs-chain.json" }] }, expRefused("INVALID_INPUT"));
addCase("sch-019-fixture-refs-missing", "schema_provenance", "fs-chain", { taskMutate: (t) => { delete t.fixture_refs.network_bundle; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-020-task-id-missing", "schema_provenance", "fs-chain", { taskMutate: (t) => { delete t.task_id; } }, {}, expRefused("INVALID_INPUT"));

// ---------- 10 budget / replay / mutation ----------
addCase("bud-001-over-budget", "budget_replay", "over-budget-100", {}, {}, expRefused("BUDGET_EXCEEDED"));
addCase("bud-002-boundary-58", "budget_replay", "boundary-58", {}, {}, expReady("boundary-58", {}));
addCase("bud-003-boundary-59", "budget_replay", "boundary-59", {}, {}, expRefused("BUDGET_EXCEEDED"));
addCase("bud-004-input-limit", "budget_replay", "fs-chain", { taskMutate: (t) => {
  const acts = {};
  for (let i = 0; i < 6000; i++) acts[`claim-${i}`] = { es: 0, ef: 1, ls: 0, lf: 1, total_float: 0 };
  t.options.claimed = { activities: acts };
} }, {}, expRefused("INPUT_LIMIT"));
addCase("bud-005-sentinel-59", "budget_replay", "sentinel-59", {}, {}, expRefused("BUDGET_EXCEEDED"));
addCase("bud-006-replay-fs", "budget_replay", "fs-chain", {}, {}, expReady("fs-chain", {}));
addCase("bud-007-replay-diamond", "budget_replay", "diamond", {}, {}, expReady("diamond", {}));
addCase("bud-008-boundary-58-with-claims", "budget_replay", "boundary-58", { claimed: { activities: { "act-b58-00": { es: 0, ef: 1, ls: 0, lf: 1, total_float: 0 } } } }, {}, expReady("boundary-58", {}, { claimed_states: ["verified"] }));
addCase("bud-009-over-budget-declared-mismatch", "budget_replay", "over-budget-100", { declared: 5 }, {}, expRefused("BUDGET_EXCEEDED"));
addCase("bud-010-sentinel-valid-tail", "budget_replay", "boundary-59", {}, {}, expRefused("BUDGET_EXCEEDED"));

// ================= Write battery.json =================
if (CASES.length !== 120) {
  console.error(`battery case count is ${CASES.length}, expected 120`);
  process.exit(1);
}
const byCat = {};
for (const c of CASES) byCat[c.category] = (byCat[c.category] || 0) + 1;
console.log("categories:", JSON.stringify(byCat));
writeFileSync(join(ROOT, "corpus", "battery.json"), JSON.stringify(CASES, null, 2) + "\n");
console.log(`battery: ${CASES.length} cases written`);
