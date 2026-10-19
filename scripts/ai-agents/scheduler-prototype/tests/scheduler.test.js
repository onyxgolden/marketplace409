/** scheduler.test.js — CPM math against hand-derived expectations.
 *  These expected values were derived manually from the brief's formulas,
 *  independent of src/scheduler.js. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeWeight, workingDays, findCycle, topoOrder, analyzeComponent } from "../src/scheduler.js";

test("edge weights per tie type (brief formulas)", () => {
  // FS w=dp+lag; SS w=lag; FF w=dp+lag-ds; SF w=lag-ds
  assert.equal(edgeWeight("FS", 5, 3, 2), 7);
  assert.equal(edgeWeight("SS", 5, 3, 2), 2);
  assert.equal(edgeWeight("FF", 5, 3, 2), 4);
  assert.equal(edgeWeight("SF", 5, 3, 2), -1);
  assert.equal(edgeWeight("FS", 5, 3, -2), 3); // negative lag allowed
});

test("workingDays skips weekends and excluded dates", () => {
  const days = workingDays("2026-01-05", 21, [1, 2, 3, 4, 5], ["2026-01-19"]);
  assert.deepEqual(days.slice(0, 5), ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]);
  assert.ok(!days.includes("2026-01-10")); // Saturday
  assert.ok(!days.includes("2026-01-11")); // Sunday
  assert.ok(!days.includes("2026-01-19")); // excluded Monday
  assert.ok(days.includes("2026-01-20")); // Tuesday after the exclusion
  assert.ok(days.includes("2026-01-12")); // Monday of week 2
});

test("findCycle reports the directed path", () => {
  const adj = new Map([["A", ["B"]], ["B", ["C"]], ["C", ["A"]]]);
  assert.deepEqual(findCycle(["A", "B", "C"], adj), ["A", "B", "C", "A"]);
  const dag = new Map([["A", ["B"]], ["B", ["C"]], ["C", []]]);
  assert.equal(findCycle(["A", "B", "C"], dag), null);
});

test("hand-derived FS chain: A(3)->B(4)->C(2)", () => {
  const r = analyzeComponent({
    componentId: "c1",
    activities: [
      { id: "A", duration_workdays: 3, release_tick: 0 },
      { id: "B", duration_workdays: 4, release_tick: 0 },
      { id: "C", duration_workdays: 2, release_tick: 0 },
    ],
    ties: [
      { id: "t1", predecessor: "A", successor: "B", type: "FS", lag_workdays: 0 },
      { id: "t2", predecessor: "B", successor: "C", type: "FS", lag_workdays: 0 },
    ],
    calendars: [{ working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [] }],
    anchorDate: "2026-01-05", horizonDays: 60, deadlineTick: null, constraints: [],
  });
  assert.equal(r.status, "READY");
  const byId = new Map(r.activities.map((a) => [a.id, a]));
  assert.deepEqual([byId.get("A").es, byId.get("A").ef, byId.get("A").ls, byId.get("A").lf, byId.get("A").total_float], [0, 3, 0, 3, 0]);
  assert.deepEqual([byId.get("B").es, byId.get("B").ef, byId.get("B").ls, byId.get("B").lf, byId.get("B").total_float], [3, 7, 3, 7, 0]);
  assert.deepEqual([byId.get("C").es, byId.get("C").ef, byId.get("C").ls, byId.get("C").lf, byId.get("C").total_float], [7, 9, 7, 9, 0]);
  assert.equal(byId.get("A").civil_start, "2026-01-05");
  assert.equal(byId.get("A").civil_finish_boundary, "2026-01-08");
  assert.deepEqual(r.critical_subgraph.activities, ["A", "B", "C"]);
  assert.deepEqual(r.critical_subgraph.edges, ["t1", "t2"]);
});

test("hand-derived diamond: noncritical branch keeps float 1", () => {
  const r = analyzeComponent({
    componentId: "c1",
    activities: [
      { id: "A", duration_workdays: 2, release_tick: 0 },
      { id: "B", duration_workdays: 3, release_tick: 0 },
      { id: "C", duration_workdays: 4, release_tick: 0 },
      { id: "D", duration_workdays: 1, release_tick: 0 },
    ],
    ties: [
      { id: "t1", predecessor: "A", successor: "B", type: "FS", lag_workdays: 0 },
      { id: "t2", predecessor: "A", successor: "C", type: "FS", lag_workdays: 0 },
      { id: "t3", predecessor: "B", successor: "D", type: "FS", lag_workdays: 0 },
      { id: "t4", predecessor: "C", successor: "D", type: "FS", lag_workdays: 0 },
    ],
    calendars: [{ working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [] }],
    anchorDate: "2026-01-05", horizonDays: 60, deadlineTick: null, constraints: [],
  });
  const byId = new Map(r.activities.map((a) => [a.id, a]));
  assert.equal(byId.get("B").total_float, 1);
  assert.equal(byId.get("B").critical, false);
  assert.deepEqual(r.critical_subgraph.activities, ["A", "C", "D"]);
  assert.deepEqual(r.critical_subgraph.edges, ["t2", "t4"]);
  // driving edges are tight regardless of criticality: t1, t2, t4
  assert.deepEqual(r.edges.filter((e) => e.driving).map((e) => e.id).sort(), ["t1", "t2", "t4"]);
});

test("SF tie with negative weight does not force early start below 0", () => {
  const r = analyzeComponent({
    componentId: "c1",
    activities: [
      { id: "A", duration_workdays: 4, release_tick: 0 },
      { id: "B", duration_workdays: 2, release_tick: 0 },
    ],
    ties: [{ id: "t1", predecessor: "A", successor: "B", type: "SF", lag_workdays: 1 }],
    calendars: [{ working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [] }],
    anchorDate: "2026-01-05", horizonDays: 60, deadlineTick: null, constraints: [],
  });
  const byId = new Map(r.activities.map((a) => [a.id, a]));
  // w = 1-2 = -1; ES(B) = max(0, 0-1) = 0; D=4; LS(B)=2; float(B)=2
  assert.deepEqual([byId.get("B").es, byId.get("B").ls, byId.get("B").total_float], [0, 2, 2]);
  assert.equal(r.edges[0].tight, false);
});

test("zero-duration milestone shares one boundary", () => {
  const r = analyzeComponent({
    componentId: "c1",
    activities: [
      { id: "A", duration_workdays: 3, release_tick: 0 },
      { id: "M", duration_workdays: 0, release_tick: 0 },
    ],
    ties: [{ id: "t1", predecessor: "A", successor: "M", type: "FS", lag_workdays: 0 }],
    calendars: [{ working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [] }],
    anchorDate: "2026-01-05", horizonDays: 60, deadlineTick: null, constraints: [],
  });
  const m = r.activities.find((a) => a.id === "M");
  assert.deepEqual([m.es, m.ef], [3, 3]);
  assert.equal(m.civil_start, m.civil_finish_boundary);
});

test("dangling tie blocks the component with the missing id", () => {
  const r = analyzeComponent({
    componentId: "c1",
    activities: [{ id: "A", duration_workdays: 2, release_tick: 0 }],
    ties: [{ id: "t1", predecessor: "A", successor: "ZZZ", type: "FS", lag_workdays: 0 }],
    calendars: [{ working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [] }],
    anchorDate: "2026-01-05", horizonDays: 60, deadlineTick: null, constraints: [],
  });
  assert.equal(r.status, "DANGLING_TIE");
  assert.equal(r.detail.missing_id, "ZZZ");
  assert.deepEqual(r.activities, []);
});

test("horizon exact boundary: maxEF == working.length exceeds", () => {
  // 2 working days in horizon (Mondays), activity d=2 => EF=2 needs working[2], which does not exist.
  const r = analyzeComponent({
    componentId: "c1",
    activities: [{ id: "A", duration_workdays: 2, release_tick: 0 }],
    ties: [],
    calendars: [{ working_weekdays: [1], excluded_dates: [] }],
    anchorDate: "2026-01-05", horizonDays: 14, deadlineTick: null, constraints: [],
  });
  assert.equal(r.status, "CALENDAR_HORIZON_EXCEEDED");
  assert.deepEqual(r.activities, []);
});

test("horizon one tick inside: maxEF == working.length - 1 is fine", () => {
  const r = analyzeComponent({
    componentId: "c1",
    activities: [{ id: "A", duration_workdays: 1, release_tick: 0 }],
    ties: [],
    calendars: [{ working_weekdays: [1], excluded_dates: [] }],
    anchorDate: "2026-01-05", horizonDays: 14, deadlineTick: null, constraints: [],
  });
  assert.equal(r.status, "READY");
  assert.equal(r.activities[0].civil_start, "2026-01-05");
  assert.equal(r.activities[0].civil_finish_boundary, "2026-01-12"); // exclusive boundary: next working day
});

test("topoOrder respects dependencies", () => {
  const preds = new Map([["A", []], ["B", ["A"]], ["C", ["B"]]]);
  const succs = new Map([["A", ["B"]], ["B", ["C"]], ["C", []]]);
  assert.deepEqual(topoOrder(["A", "B", "C"], preds, succs), ["A", "B", "C"]);
});

// ---- S648-003: late-date horizon validation ----

function horizonComponent({ deadlineTick = null, constraints = [], horizonDays = 10 }) {
  // One 1-day activity. Anchor 2026-01-05 (Monday), horizonDays=10 calendar
  // days -> 8 working days (Mon-Fri, no exclusions). Valid tick indices
  // are 0..7; working.length = 8.
  return analyzeComponent({
    componentId: "c1",
    activities: [{ id: "A", duration_workdays: 1, release_tick: 0 }],
    ties: [],
    calendars: [{ working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [] }],
    anchorDate: "2026-01-05",
    horizonDays,
    deadlineTick,
    constraints,
  });
}

test("S648-003: loose explicit deadline within horizon stays READY", () => {
  // working.length=8; deadline D=7 -> LS=6, LF=7, all in [0,8).
  const r = horizonComponent({ deadlineTick: 7 });
  assert.equal(r.status, "READY");
  assert.equal(r.activities[0].lf, 7);
});

test("S648-003: explicit deadline at working.length refuses (exact boundary)", () => {
  // D=8 -> LF=8 needs working[8], but valid indices are 0..7.
  const r = horizonComponent({ deadlineTick: 8 });
  assert.equal(r.status, "CALENDAR_HORIZON_EXCEEDED");
  assert.match(r.reason, /LF=8/);
});

test("S648-003: explicit deadline past horizon (+1) refuses", () => {
  const r = horizonComponent({ deadlineTick: 9 });
  assert.equal(r.status, "CALENDAR_HORIZON_EXCEEDED");
});

test("S648-003: in-range ES/EF with out-of-range LS/LF refuses (verdict example)", () => {
  // One-day activity, short horizon, much later permitted deadline.
  // ES=0, EF=1 in range; LS/LF pushed past working.length by the deadline.
  const r = horizonComponent({ deadlineTick: 50, horizonDays: 10 });
  assert.equal(r.status, "CALENDAR_HORIZON_EXCEEDED");
});
