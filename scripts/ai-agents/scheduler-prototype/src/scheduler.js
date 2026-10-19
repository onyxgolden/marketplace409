/**
 * scheduler.js — deterministic CPM network recomputation for the
 * Scheduler Agent prototype. Pure invented scheduling arithmetic:
 * early/late start/finish, total float, critical/driving edges, and
 * calendar tick mapping. No real project data, no commitments.
 * Pure Node 24 ESM, zero dependencies.
 */

import { dayNumberOf, civilOfDayNumber, isoWeekdayOf } from "./canonical.js";

/**
 * S648-002: extract the verified source citation preserved on an admitted
 * network record by the runtime (index.js). Records that never carried a
 * span (synthetic unit-test inputs) get an explicit unavailable state.
 */
function citationOf(record) {
  if (record && record._citation && typeof record._citation === "object") {
    const c = record._citation;
    return {
      quoted_span: c.quoted_span ?? null,
      span: c.span ?? null,
      verification: c.verification ?? "unavailable",
    };
  }
  return {
    quoted_span: null,
    span: null,
    verification: "unavailable",
    reason: "no source span preserved for this record",
  };
}

/** Edge weight w for the inequality start(succ) >= start(pred) + w. */
export function edgeWeight(type, dPred, dSucc, lag) {
  switch (type) {
    case "FS": return dPred + lag;
    case "SS": return lag;
    case "FF": return dPred + lag - dSucc;
    case "SF": return lag - dSucc;
    default: throw new Error(`unknown tie type '${type}'`);
  }
}

/**
 * Ordered list of working civil dates in [anchor, anchor+horizon).
 * A day counts iff its ISO weekday is in the mask and it is not an
 * excluded date. Excluded dates consume no working ticks.
 */
export function workingDays(anchorDate, horizonDays, workingWeekdays, excludedDates) {
  const excl = new Set(excludedDates);
  const out = [];
  const base = dayNumberOf(anchorDate);
  for (let d = 0; d < horizonDays; d++) {
    const civil = civilOfDayNumber(base + d);
    if (workingWeekdays.includes(isoWeekdayOf(civil)) && !excl.has(civil)) out.push(civil);
  }
  return out;
}

/**
 * Find a directed cycle in adj (Map id -> [successor ids]).
 * Returns the cycle as an ordered id list (first id repeated at the end),
 * or null when acyclic. Iterative DFS with explicit stack.
 */
export function findCycle(ids, adj) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(ids.map((id) => [id, WHITE]));
  const stack = [];
  for (const root of ids) {
    if (color.get(root) !== WHITE) continue;
    stack.push({ id: root, it: 0 });
    color.set(root, GRAY);
    const path = [root];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const succs = adj.get(top.id) ?? [];
      if (top.it < succs.length) {
        const s = succs[top.it++];
        const c = color.get(s);
        if (c === GRAY) {
          const start = path.indexOf(s);
          return [...path.slice(start), s];
        }
        if (c === WHITE) {
          color.set(s, GRAY);
          stack.push({ id: s, it: 0 });
          path.push(s);
        }
      } else {
        color.set(top.id, BLACK);
        stack.pop();
        path.pop();
      }
    }
  }
  return null;
}

/** Kahn's topological order. Assumes acyclic. Returns id list. */
export function topoOrder(ids, preds, succs) {
  const indeg = new Map(ids.map((id) => [id, preds.get(id).length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const s of succs.get(id)) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  return order;
}

/**
 * Analyze one connected component. Inputs are already schema-validated.
 *
 * Returns {
 *   status: "READY" | "UNVERIFIABLE" | "UNSUPPORTED_CALENDAR" |
 *           "CALENDAR_NO_WORKING_DAYS" | "DANGLING_TIE" | "CYCLE_DETECTED" |
 *           "CALENDAR_HORIZON_EXCEEDED" | "CONSTRAINT_UNSATISFIABLE",
 *   reason, detail,
 *   anchor_date, horizon_days, working_days, tick_count,
 *   deadline_tick,
 *   activities: [{id, es, ef, ls, lf, total_float, critical, civil_start, civil_finish_boundary}],
 *   edges: [{id, predecessor, successor, type, lag_workdays, weight, tight, critical, driving}],
 *   critical_subgraph: {activities: [...ids], edges: [...ids]},
 * }
 *
 * Non-READY statuses carry no activity dates (never guessed).
 */
export function analyzeComponent(args) {
  const { componentId, activities, ties, calendars, anchorDate, horizonDays, deadlineTick, constraints } = args;
  const fail = (status, reason, detail = null) => ({
    status, reason, detail,
    component_id: componentId,
    anchor_date: anchorDate ?? null,
    horizon_days: horizonDays,
    working_days: [],
    tick_count: 0,
    deadline_tick: deadlineTick ?? null,
    activities: [],
    edges: [],
    critical_subgraph: { activities: [], edges: [] },
  });

  if (calendars.length === 0) {
    return fail("UNVERIFIABLE", `component '${componentId}' has no calendar record; no working-day clock, no dates`);
  }
  if (calendars.length > 1) {
    return fail("UNSUPPORTED_CALENDAR", `component '${componentId}' has ${calendars.length} calendar records; mixed calendars within a component are not converted or approximated`);
  }
  if (!anchorDate) {
    return fail("UNVERIFIABLE", `component '${componentId}' has no anchor date; isolated unanchored work gets no dates`);
  }
  const cal = calendars[0];
  const working = workingDays(anchorDate, horizonDays, cal.working_weekdays, cal.excluded_dates);
  if (working.length === 0) {
    return fail("CALENDAR_NO_WORKING_DAYS", `component '${componentId}' has no working day in the ${horizonDays}-day horizon`);
  }

  const actById = new Map(activities.map((a) => [a.id, a]));
  const ids = [...actById.keys()];
  // Dangling endpoints block all math for the component.
  for (const t of ties) {
    for (const [role, ref] of [["predecessor", t.predecessor], ["successor", t.successor]]) {
      if (!actById.has(ref)) {
        return fail("DANGLING_TIE", `tie '${t.id}' references unknown ${role} activity '${ref}'`, { tie_id: t.id, role, missing_id: ref });
      }
    }
  }

  const succs = new Map(ids.map((id) => [id, []]));
  const preds = new Map(ids.map((id) => [id, []]));
  const weights = new Map(); // tie id -> w
  for (const t of ties) {
    const w = edgeWeight(t.type, actById.get(t.predecessor).duration_workdays, actById.get(t.successor).duration_workdays, t.lag_workdays);
    weights.set(t.id, w);
    succs.get(t.predecessor).push(t.successor);
    preds.get(t.successor).push(t.predecessor);
  }
  const tieByPair = new Map(); // "pred|succ" -> [tie]
  for (const t of ties) {
    const k = `${t.predecessor}|${t.successor}`;
    if (!tieByPair.has(k)) tieByPair.set(k, []);
    tieByPair.get(k).push(t);
  }

  const cycle = findCycle(ids, succs);
  if (cycle) {
    return fail("CYCLE_DETECTED", `directed cycle blocks all math for component '${componentId}'`, { cycle_path: cycle });
  }
  const order = topoOrder(ids, preds, succs);

  // Lower bounds: release_tick, START_NO_EARLIER_THAN, MUST_FINISH_ON lower.
  const lower = new Map();
  for (const a of activities) lower.set(a.id, a.release_tick);
  for (const c of constraints) {
    if (!actById.has(c.activity_id)) continue; // foreign-component constraints ignored here
    if (c.kind === "START_NO_EARLIER_THAN") {
      lower.set(c.activity_id, Math.max(lower.get(c.activity_id), c.tick));
    } else if (c.kind === "MUST_FINISH_ON") {
      const d = actById.get(c.activity_id).duration_workdays;
      lower.set(c.activity_id, Math.max(lower.get(c.activity_id), c.tick - d));
    }
  }

  // Forward pass.
  const ES = new Map();
  const EF = new Map();
  for (const id of order) {
    let es = Math.max(0, lower.get(id));
    for (const p of preds.get(id)) {
      for (const t of tieByPair.get(`${p}|${id}`) ?? []) {
        es = Math.max(es, ES.get(p) + weights.get(t.id));
      }
    }
    ES.set(id, es);
    EF.set(id, es + actById.get(id).duration_workdays);
  }

  const maxEF = ids.length === 0 ? 0 : Math.max(...ids.map((id) => EF.get(id)));
  if (ids.length > 0 && maxEF >= working.length) {  // EF tick e needs working[e]; valid indices are 0..working.length-1
    return fail(
      "CALENDAR_HORIZON_EXCEEDED",
      `component '${componentId}' needs tick ${maxEF} but only ${working.length} working days exist in the horizon; no dates guessed`,
      { required_ticks: maxEF, available_ticks: working.length }
    );
  }

  // Upper bounds: component deadline, MUST_FINISH_ON / FINISH_NO_LATER_THAN.
  const D = deadlineTick ?? maxEF;
  const upper = new Map();
  for (const a of activities) upper.set(a.id, D - a.duration_workdays);
  for (const c of constraints) {
    if (!actById.has(c.activity_id)) continue;
    const d = actById.get(c.activity_id).duration_workdays;
    if (c.kind === "MUST_FINISH_ON" || c.kind === "FINISH_NO_LATER_THAN") {
      upper.set(c.activity_id, Math.min(upper.get(c.activity_id), c.tick - d));
    }
  }

  // Backward pass: LS init then reverse-topological min propagation.
  const LS = new Map();
  for (const id of ids) LS.set(id, upper.get(id));
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    for (const s of succs.get(id)) {
      for (const t of tieByPair.get(`${id}|${s}`) ?? []) {
        LS.set(id, Math.min(LS.get(id), LS.get(s) - weights.get(t.id)));
      }
    }
  }
  const LF = new Map(ids.map((id) => [id, LS.get(id) + actById.get(id).duration_workdays]));

  // Lower/upper inconsistency => unsatisfiable, never a feasible schedule.
  for (const id of ids) {
    if (ES.get(id) > LS.get(id)) {
      const a = actById.get(id);
      return {
        ...fail(
          "CONSTRAINT_UNSATISFIABLE",
          `activity '${id}' lower bound ES=${ES.get(id)} exceeds upper bound LS=${LS.get(id)}; no feasible schedule`,
          { activity_id: id, computed_es: ES.get(id), computed_ls: LS.get(id), computed_ef: EF.get(id), computed_lf: LF.get(id), total_float: LS.get(id) - ES.get(id) }
        ),
        activities: ids.map((x) => ({
          id: x,
          es: ES.get(x),
          ef: EF.get(x),
          ls: LS.get(x),
          lf: LF.get(x),
          total_float: LS.get(x) - ES.get(x),
          critical: false,
          civil_start: null,
          civil_finish_boundary: null,
          citation: citationOf(actById.get(x)),
        })),
      };
    }
  }

  // S648-003: every exposed ES/EF/LS/LF boundary must map to a real
  // calendar boundary. An explicit deadline or upper constraint can push
  // LS/LF past the horizon while ES/EF stay in range; that is
  // CALENDAR_HORIZON_EXCEEDED, never a READY with unmapped dates.
  for (const id of ids) {
    for (const [label, tick] of [["ES", ES.get(id)], ["EF", EF.get(id)], ["LS", LS.get(id)], ["LF", LF.get(id)]]) {
      if (!Number.isInteger(tick) || tick < 0 || tick >= working.length) {
        return fail(
          "CALENDAR_HORIZON_EXCEEDED",
          `component '${componentId}' activity '${id}' ${label}=${tick} has no calendar boundary (only ${working.length} working days in the horizon); no dates guessed`,
          { activity_id: id, boundary: label, tick, available_ticks: working.length }
        );
      }
    }
  }

  const floatOf = (id) => LS.get(id) - ES.get(id);
  const criticalIds = new Set(ids.filter((id) => floatOf(id) === 0));
  const tightTieIds = new Set();
  for (const t of ties) {
    if (ES.get(t.successor) === ES.get(t.predecessor) + weights.get(t.id)) tightTieIds.add(t.id);
  }
  const criticalTieIds = new Set([...tightTieIds].filter((tid) => {
    const t = ties.find((x) => x.id === tid);
    return criticalIds.has(t.predecessor) && criticalIds.has(t.successor);
  }));

  const activityRows = ids.map((id) => {
    const a = actById.get(id);
    const es = ES.get(id);
    const ef = EF.get(id);
    return {
      id,
      es,
      ef,
      ls: LS.get(id),
      lf: LF.get(id),
      total_float: floatOf(id),
      critical: criticalIds.has(id),
      civil_start: working[es],
      // Finish boundary: start of the next working boundary after the last
      // occupied slot; zero-duration milestones start/finish at the same
      // boundary.
      civil_finish_boundary: a.duration_workdays === 0 ? working[es] : working[ef],
      citation: citationOf(a),
    };
  });

  const edgeRows = ties.map((t) => ({
    id: t.id,
    predecessor: t.predecessor,
    successor: t.successor,
    type: t.type,
    lag_workdays: t.lag_workdays,
    weight: weights.get(t.id),
    tight: tightTieIds.has(t.id),
    critical: criticalTieIds.has(t.id),
    driving: tightTieIds.has(t.id),
    citation: citationOf(t),
  }));

  return {
    status: "READY",
    reason: null,
    detail: null,
    component_id: componentId,
    anchor_date: anchorDate,
    horizon_days: horizonDays,
    working_days: working,
    tick_count: working.length,
    deadline_tick: deadlineTick ?? null,
    activities: activityRows,
    edges: edgeRows,
    critical_subgraph: {
      activities: [...criticalIds].sort(),
      edges: [...criticalTieIds].sort(),
    },
  };
}
