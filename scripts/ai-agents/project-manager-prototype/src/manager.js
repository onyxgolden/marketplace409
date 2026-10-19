// manager.js — plan-health domain analysis (FS-only forward pass).
// All intervals [start,end); tick = one invented elapsed hour.
// Every candidate (task, edge, milestone, window, demand) is charged on the
// resolver budget BEFORE its fields are read (S648-001).

export const SEVERITY = {
  BLOCKING_MATH: 'BLOCKING_MATH', // cycle / dangling — no derived dates
  MISMATCH: 'MISMATCH',           // impossible milestone / overcapacity
  UNVERIFIABLE: 'UNVERIFIABLE',   // missing basis
  INFO: 'INFO',
};

function diag(code, severity, record_id, reason) {
  return { code, severity, record_id, source_ref: null, reason };
}

/**
 * Analyze one plan package. Returns { status, math, findings, orphans,
 * milestones, resources, completion, header } where status is
 * REPORT_READY | PARTIAL | REFUSED.
 * resolver: budget-charging resolver (chargeObject before each candidate).
 */
export function analyzePlan(pkg, resolver) {
  const findings = [];
  const charge = () => resolver.chargeObject();

  // ---- 0. charge + index tasks; duplicate task IDs -> REFUSED ----
  const tasks = new Map();
  for (const t of pkg.tasks || []) {
    charge();
    if (tasks.has(t.task_id)) {
      return refused(`duplicate task_id: ${t.task_id}`, findings);
    }
    tasks.set(t.task_id, t);
  }

  // ---- 1. charge + validate edges; duplicates, dangling, self-loops ----
  const edges = [];
  const seenEdgeIds = new Set();
  const preds = new Map(); // task_id -> [{from, lag}]
  for (const t of tasks.keys()) preds.set(t, []);
  let dangling = null;
  for (const e of pkg.edges || []) {
    charge();
    if (seenEdgeIds.has(e.edge_id)) {
      return refused(`duplicate edge_id: ${e.edge_id}`, findings);
    }
    seenEdgeIds.add(e.edge_id);
    if (!tasks.has(e.from_task) || !tasks.has(e.to_task)) {
      dangling = e;
      findings.push(diag('DANGLING_DEPENDENCY', SEVERITY.BLOCKING_MATH, e.edge_id,
        `edge references unknown task: ${!tasks.has(e.from_task) ? e.from_task : e.to_task}`));
    } else {
      edges.push(e);
      preds.get(e.to_task).push({ from: e.from_task, lag: e.lag_ticks, edge_id: e.edge_id });
    }
  }

  // ---- 2. forward pass (Kahn); cycle -> PARTIAL, math null ----
  const es = new Map(); // task_id -> earliest start
  const ef = new Map(); // task_id -> earliest finish
  const indeg = new Map();
  for (const t of tasks.keys()) indeg.set(t, 0);
  for (const e of edges) indeg.set(e.to_task, indeg.get(e.to_task) + 1);

  const queue = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const order = [];
  while (queue.length) {
    // deterministic: lexical order
    queue.sort();
    const id = queue.shift();
    order.push(id);
    for (const e of edges) {
      if (e.from_task === id) {
        const d = indeg.get(e.to_task) - 1;
        indeg.set(e.to_task, d);
        if (d === 0) queue.push(e.to_task);
      }
    }
  }

  if (dangling || order.length !== tasks.size) {
    if (!dangling) {
      const cyclic = [...tasks.keys()].filter((id) => !order.includes(id)).sort();
      findings.push(diag('CYCLE_DETECTED', SEVERITY.BLOCKING_MATH, null,
        `cycle involves tasks: ${cyclic.join(', ')}`));
    }
    return {
      status: 'PARTIAL', math: null, findings,
      orphans: [], milestones: [], resources: [], completion: null, header: null,
    };
  }

  for (const id of order) {
    const t = tasks.get(id);
    let start = pkg.project_start_tick;
    if (t.release_tick !== null && t.release_tick !== undefined) {
      start = Math.max(start, t.release_tick);
    }
    for (const p of preds.get(id)) {
      start = Math.max(start, ef.get(p.from) + p.lag);
    }
    es.set(id, start);
    ef.set(id, start + t.duration_ticks);
    // claimed start violating predecessor bounds -> flagged, network unchanged
    if (t.declared_start_tick !== null && t.declared_start_tick !== undefined) {
      let minStart = pkg.project_start_tick;
      if (t.release_tick !== null && t.release_tick !== undefined) minStart = Math.max(minStart, t.release_tick);
      for (const p of preds.get(id)) minStart = Math.max(minStart, ef.get(p.from) + p.lag);
      if (t.declared_start_tick < minStart) {
        findings.push(diag('CLAIMED_START_VIOLATION', SEVERITY.MISMATCH, id,
          `declared_start_tick ${t.declared_start_tick} < earliest feasible ${minStart}`));
      }
    }
  }

  const math = {};
  for (const id of [...tasks.keys()].sort()) math[id] = { es: es.get(id), ef: ef.get(id) };

  // ---- 3. milestones ----
  const milestoneResults = [];
  const milestoneTaskIds = new Set();
  for (const m of pkg.milestones || []) {
    charge();
    for (const rt of m.required_tasks) milestoneTaskIds.add(rt);
    const missing = m.required_tasks.filter((rt) => !tasks.has(rt));
    if (missing.length) {
      findings.push(diag('MILESTONE_MISSING_REQUIREMENT', SEVERITY.UNVERIFIABLE, m.milestone_id,
        `required tasks not in plan: ${missing.join(', ')}`));
      milestoneResults.push({ milestone_id: m.milestone_id, earliest_feasible_tick: null, claimed_tick: m.claimed_tick ?? null, assessment: 'UNVERIFIABLE' });
      continue;
    }
    if (m.required_tasks.length === 0) {
      milestoneResults.push({ milestone_id: m.milestone_id, earliest_feasible_tick: null, claimed_tick: m.claimed_tick ?? null, assessment: 'UNVERIFIABLE' });
      findings.push(diag('MILESTONE_NO_REQUIREMENTS', SEVERITY.UNVERIFIABLE, m.milestone_id, 'empty required_tasks'));
      continue;
    }
    const earliest = Math.max(...m.required_tasks.map((rt) => ef.get(rt)));
    let assessment;
    if (m.claimed_tick === null || m.claimed_tick === undefined) {
      assessment = 'UNVERIFIABLE';
      findings.push(diag('MILESTONE_NO_CLAIM', SEVERITY.UNVERIFIABLE, m.milestone_id, 'no claimed tick'));
    } else if (m.claimed_tick < earliest) {
      assessment = 'MISMATCH';
      findings.push(diag('MILESTONE_IMPOSSIBLE', SEVERITY.MISMATCH, m.milestone_id,
        `claimed ${m.claimed_tick} < earliest feasible ${earliest}`));
    } else {
      assessment = 'FEASIBLE';
    }
    milestoneResults.push({ milestone_id: m.milestone_id, earliest_feasible_tick: earliest, claimed_tick: m.claimed_tick ?? null, assessment });
  }

  // ---- 4. orphans: tasks with no directed path to any milestone requirement ----
  // Build reverse reachability from milestone requirements.
  const succs = new Map();
  for (const t of tasks.keys()) succs.set(t, []);
  for (const e of edges) succs.get(e.from_task).push(e.to_task);
  const reaches = new Set(milestoneTaskIds);
  const stack = [...milestoneTaskIds].filter((id) => tasks.has(id));
  while (stack.length) {
    const id = stack.pop();
    for (const e of edges) {
      if (e.to_task === id && !reaches.has(e.from_task)) {
        reaches.add(e.from_task);
        stack.push(e.from_task);
      }
    }
  }
  const orphans = [...tasks.keys()].filter((id) => !reaches.has(id)).sort();
  if (orphans.length) {
    findings.push(diag('ORPHAN_TASKS', SEVERITY.UNVERIFIABLE, null,
      `tasks with no path to any milestone requirement: ${orphans.join(', ')}`));
  }

  // ---- 5. resources ----
  const resourceResults = [];
  // index windows per resource; charge each
  const windowsByRes = new Map();
  for (const w of pkg.capacity_windows || []) {
    charge();
    if (!windowsByRes.has(w.resource_id)) windowsByRes.set(w.resource_id, []);
    windowsByRes.get(w.resource_id).push(w);
  }
  // window structural checks: nonoverlapping per resource
  for (const [res, wins] of windowsByRes) {
    const sorted = [...wins].sort((a, b) => a.start_tick - b.start_tick);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start_tick < sorted[i - 1].end_tick) {
        findings.push(diag('CAPACITY_WINDOW_OVERLAP', SEVERITY.UNVERIFIABLE, sorted[i].window_id,
          `overlaps window ${sorted[i - 1].window_id} for resource ${res}`));
      }
    }
  }
  // demand intervals from tasks (declared planned intervals: [es, ef))
  const demandsByRes = new Map(); // res -> [{start, end, num, den, task_id}]
  for (const [id, t] of tasks) {
    for (const d of t.resource_demands || []) {
      charge();
      if (t.duration_ticks === 0 && (d.amount_num !== 0)) {
        findings.push(diag('ZERO_DURATION_DEMAND', SEVERITY.MISMATCH, id,
          `nonzero demand on zero-duration task`));
        continue;
      }
      if (!demandsByRes.has(d.resource_id)) demandsByRes.set(d.resource_id, []);
      demandsByRes.get(d.resource_id).push({
        start: es.get(id), end: ef.get(id),
        num: d.amount_num, den: d.amount_den, task_id: id,
      });
    }
  }
  const allResources = new Set([...demandsByRes.keys(), ...windowsByRes.keys()]);
  for (const res of [...allResources].sort()) {
    const demands = demandsByRes.get(res) || [];
    const wins = (windowsByRes.get(res) || []).sort((a, b) => a.start_tick - b.start_tick);
    if (!demands.length) continue;
    const lo = Math.min(...demands.map((d) => d.start));
    const hi = Math.max(...demands.map((d) => d.end));
    // coverage: windows must fully cover [lo, hi)
    let covered = true;
    let cursor = lo;
    for (const w of wins) {
      if (w.start_tick > cursor) { covered = false; break; }
      cursor = Math.max(cursor, w.end_tick);
    }
    if (cursor < hi) covered = false;
    if (!covered || !wins.length) {
      findings.push(diag('CAPACITY_COVERAGE_GAP', SEVERITY.UNVERIFIABLE, null,
        `capacity windows for ${res} do not fully cover demand interval [${lo},${hi})`));
      resourceResults.push({ resource_id: res, assessment: 'UNVERIFIABLE', conflicts: [] });
      continue;
    }
    // cutpoints: every demand start/end; abutment [end,start] never overlaps
    const cuts = [...new Set(demands.flatMap((d) => [d.start, d.end]))].sort((a, b) => a - b);
    const conflicts = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b <= a) continue;
      // active demands on [a,b): start <= a < end
      const active = demands.filter((d) => d.start <= a && a < d.end);
      if (!active.length) continue;
      // sum as rational: common denominator via product (small ints in fixtures)
      let num = 0, den = 1;
      for (const d of active) { num = num * d.den + d.num * den; den = den * d.den; }
      // capacity at cutpoint: window containing a
      const w = wins.find((x) => x.start_tick <= a && a < x.end_tick);
      const cap = w ? w.capacity : 0;
      if (num > cap * den) {
        conflicts.push({
          interval: [a, b],
          demand_num: num, demand_den: den,
          capacity: cap,
          tasks: active.map((d) => d.task_id).sort(),
        });
      }
    }
    if (conflicts.length) {
      findings.push(diag('RESOURCE_OVERALLOCATION', SEVERITY.MISMATCH, null,
        `resource ${res} over capacity in ${conflicts.length} interval(s)`));
      resourceResults.push({ resource_id: res, assessment: 'OVERALLOCATED', conflicts });
    } else {
      resourceResults.push({ resource_id: res, assessment: 'OK', conflicts: [] });
    }
  }

  // ---- 6. completion ----
  let completeCount = 0;
  for (const t of tasks.values()) if (t.status === 'COMPLETE') completeCount++;
  const completion = {
    complete: completeCount,
    total: tasks.size,
    ratio: tasks.size === 0 ? null : completeCount / tasks.size,
    ratio_defined: tasks.size !== 0,
  };
  let header = null;
  if (pkg.header_claims && pkg.header_claims.claimed_completion_pct !== undefined && pkg.header_claims.claimed_completion_pct !== null) {
    const claimed = pkg.header_claims.claimed_completion_pct;
    const actualPct = tasks.size === 0 ? null : (completeCount / tasks.size) * 100;
    const match = actualPct !== null && Math.abs(actualPct - claimed) < 1e-9;
    header = { claimed_completion_pct: claimed, computed_pct: actualPct, match };
    if (!match) {
      findings.push(diag('HEADER_COMPLETION_MISMATCH', SEVERITY.MISMATCH, null,
        `header claims ${claimed}% but computed ${actualPct === null ? 'undefined' : actualPct.toFixed(4) + '%'}`));
    }
  }

  const blocking = findings.some((f) => f.severity === SEVERITY.BLOCKING_MATH);
  return {
    status: blocking ? 'PARTIAL' : 'REPORT_READY',
    math, findings, orphans, milestones: milestoneResults,
    resources: resourceResults, completion, header,
  };
}

function refused(reason, findings) {
  return {
    status: 'REFUSED', math: null,
    findings: [...findings, diag('INVALID_INPUT', 'high', null, reason)],
    orphans: [], milestones: [], resources: [], completion: null, header: null,
  };
}
