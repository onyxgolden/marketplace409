// manager.js — plan-health domain analysis (FS-only forward pass).
// All intervals [start,end); tick = one invented elapsed hour.
// Every candidate (task, edge, milestone, window, demand) is charged on the
// resolver budget BEFORE its fields are read.
// Rational math is EXACT via BigInt (PM651-005): no float epsilon, no
// Infinity/NaN. Resources use declared intervals only (PM651-004).
// Cycle detection emits a real witness path (PM651-010).

export const SEVERITY = {
  BLOCKING_MATH: 'BLOCKING_MATH',
  MISMATCH: 'MISMATCH',
  UNVERIFIABLE: 'UNVERIFIABLE',
  INFO: 'INFO',
};

function diag(code, severity, record_id, reason, record_key) {
  const d = { code, severity, record_id, source_ref: null, reason };
  if (record_key) d.record_key = record_key;
  return d;
}

// ---- exact rational arithmetic (BigInt) ----

function bigGcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  return a === 0n ? 1n : a;
}

/** Reduce num/den; both BigInt. Returns [num, den]. */
function reduce(num, den) {
  if (den === 0n) throw new Error('zero denominator');
  const g = bigGcd(num, den);
  return [num / g, den / g];
}

/** Compare a/b vs c/d (BigInt). Returns -1, 0, 1. */
function cmpRat(a, b, c, d) {
  const l = a * d, r = c * b;
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * Analyze one plan package. Returns { status, math, findings, orphans,
 * milestones, resources, completion, header }.
 * resolver: budget-charging resolver. bytes: original fixture bytes for
 * span citations. citation: verified SourceRef for the package.
 * population: optional host-established { expected_tasks } — completion is
 * verified ONLY if the declaration matches the admitted task count
 * (PM651-006). Absent/unknown coverage never yields verified:true.
 */
export function analyzePlan(pkg, resolver, bytes, citation, population) {
  const findings = [];
  const charge = () => resolver.chargeObject();

  // ---- 0. index tasks; null-prototype map defeats __proto__ (PM651-007) ----
  const tasks = new Map();
  for (const t of pkg.tasks || []) {
    charge();
    // task_id already validated as safe key by schemas.
    if (tasks.has(t.task_id)) {
      return refused(`duplicate task_id: ${t.task_id}`, findings);
    }
    tasks.set(t.task_id, t);
  }

  // ---- 1. edges; duplicates, dangling, self-loops ----
  const edges = [];
  const seenEdgeIds = new Set();
  const preds = new Map();
  const succs = new Map();
  const indeg = new Map();
  for (const id of tasks.keys()) { preds.set(id, []); succs.set(id, []); indeg.set(id, 0); }
  let dangling = null;
  for (const e of pkg.edges || []) {
    charge();
    if (seenEdgeIds.has(e.edge_id)) {
      return refused(`duplicate edge_id: ${e.edge_id}`, findings);
    }
    seenEdgeIds.add(e.edge_id);
    if (e.from_task === e.to_task) {
      findings.push(diag('SELF_LOOP', SEVERITY.BLOCKING_MATH, e.edge_id,
        `edge from task to itself: ${e.from_task}`, 'edge_id'));
      dangling = dangling || e;
      continue;
    }
    if (!tasks.has(e.from_task) || !tasks.has(e.to_task)) {
      dangling = e;
      findings.push(diag('DANGLING_DEPENDENCY', SEVERITY.BLOCKING_MATH, e.edge_id,
        `edge references unknown task: ${!tasks.has(e.from_task) ? e.from_task : e.to_task}`, 'edge_id'));
    } else {
      edges.push(e);
      preds.get(e.to_task).push({ from: e.from_task, lag: e.lag_ticks, edge_id: e.edge_id });
      succs.get(e.from_task).push(e.to_task);
      indeg.set(e.to_task, indeg.get(e.to_task) + 1);
    }
  }

  // ---- 2. forward pass (Kahn); real cycle witness on failure (PM651-010) ----
  const es = new Map();
  const ef = new Map();
  const queue = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const order = [];
  const indegWork = new Map(indeg);
  while (queue.length) {
    queue.sort();
    const id = queue.shift();
    order.push(id);
    for (const to of succs.get(id)) {
      const d = indegWork.get(to) - 1;
      indegWork.set(to, d);
      if (d === 0) queue.push(to);
    }
  }

  if (dangling || order.length !== tasks.size) {
    if (!dangling) {
      // Find an ACTUAL cycle witness via DFS, not the Kahn remainder.
      const witness = findCycleWitness(tasks, succs);
      if (witness) {
        findings.push(diag('CYCLE_DETECTED', SEVERITY.BLOCKING_MATH, null,
          `cycle path: ${witness.join(' -> ')}`));
      } else {
        // Should not happen, but fail safe.
        findings.push(diag('CYCLE_DETECTED', SEVERITY.BLOCKING_MATH, null,
          'cyclic dependency detected (witness unavailable)'));
      }
    }
    return {
      status: 'PARTIAL', math: null, findings,
      orphans: [], milestones: [], resources: [], completion: null, header: null,
    };
  }

  for (const id of order) {
    const t = tasks.get(id);
    // PM651-005: exact tick arithmetic via BigInt. Number addition loses
    // precision above MAX_SAFE_INTEGER (e.g. 9007199254740991+2). We compute
    // in BigInt and refuse if the exact result is not a safe integer.
    let start = BigInt(pkg.project_start_tick);
    if (t.release_tick !== null && t.release_tick !== undefined) {
      const rt = BigInt(t.release_tick);
      if (rt > start) start = rt;
    }
    for (const p of preds.get(id)) {
      const cand = BigInt(ef.get(p.from)) + BigInt(p.lag);
      if (cand > start) start = cand;
    }
    const end = start + BigInt(t.duration_ticks);
    // Refuse before an unsafe derived sum.
    if (start > BigInt(Number.MAX_SAFE_INTEGER) || end > BigInt(Number.MAX_SAFE_INTEGER)) {
      findings.push(diag('UNSAFE_TICK_ARITHMETIC', SEVERITY.BLOCKING_MATH, id,
        `derived tick exceeds MAX_SAFE_INTEGER: start=${start}, end=${end}`, 'task_id'));
      return {
        status: 'PARTIAL', math: null, findings,
        orphans: [], milestones: [], resources: [], completion: null, header: null,
      };
    }
    const startNum = Number(start);
    const endNum = Number(end);
    es.set(id, startNum);
    ef.set(id, endNum);
    if (t.declared_start_tick !== null && t.declared_start_tick !== undefined) {
      let minStart = BigInt(pkg.project_start_tick);
      if (t.release_tick !== null && t.release_tick !== undefined) {
        const rt = BigInt(t.release_tick);
        if (rt > minStart) minStart = rt;
      }
      for (const p of preds.get(id)) {
        const cand = BigInt(ef.get(p.from)) + BigInt(p.lag);
        if (cand > minStart) minStart = cand;
      }
      const minStartNum = minStart > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER + 1 // forces violation below; already refused above if end unsafe
        : Number(minStart);
      if (t.declared_start_tick < minStartNum) {
        findings.push(diag('CLAIMED_START_VIOLATION', SEVERITY.MISMATCH, id,
          `declared_start_tick ${t.declared_start_tick} < earliest feasible ${minStart}`, 'task_id'));
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
        `required tasks not in plan: ${missing.join(', ')}`, 'milestone_id'));
      milestoneResults.push({ milestone_id: m.milestone_id, earliest_feasible_tick: null, claimed_tick: m.claimed_tick ?? null, assessment: 'UNVERIFIABLE' });
      continue;
    }
    if (m.required_tasks.length === 0) {
      milestoneResults.push({ milestone_id: m.milestone_id, earliest_feasible_tick: null, claimed_tick: m.claimed_tick ?? null, assessment: 'UNVERIFIABLE' });
      findings.push(diag('MILESTONE_NO_REQUIREMENTS', SEVERITY.UNVERIFIABLE, m.milestone_id, 'empty required_tasks', 'milestone_id'));
      continue;
    }
    const earliest = Math.max(...m.required_tasks.map((rt) => ef.get(rt)));
    let assessment;
    if (m.claimed_tick === null || m.claimed_tick === undefined) {
      assessment = 'UNVERIFIABLE';
      findings.push(diag('MILESTONE_NO_CLAIM', SEVERITY.UNVERIFIABLE, m.milestone_id, 'no claimed tick', 'milestone_id'));
    } else if (m.claimed_tick < earliest) {
      assessment = 'MISMATCH';
      findings.push(diag('MILESTONE_IMPOSSIBLE', SEVERITY.MISMATCH, m.milestone_id,
        `claimed ${m.claimed_tick} < earliest feasible ${earliest}`, 'milestone_id'));
    } else {
      assessment = 'FEASIBLE';
    }
    milestoneResults.push({ milestone_id: m.milestone_id, earliest_feasible_tick: earliest, claimed_tick: m.claimed_tick ?? null, assessment });
  }

  // ---- 4. orphans ----
  const reaches = new Set(milestoneTaskIds);
  const stack = [...milestoneTaskIds].filter((id) => tasks.has(id));
  while (stack.length) {
    const id = stack.pop();
    for (const p of preds.get(id)) {
      if (!reaches.has(p.from)) {
        reaches.add(p.from);
        stack.push(p.from);
      }
    }
  }
  const orphans = [...tasks.keys()].filter((id) => !reaches.has(id)).sort();
  if (orphans.length) {
    findings.push(diag('ORPHAN_TASKS', SEVERITY.UNVERIFIABLE, null,
      `tasks with no path to any milestone requirement: ${orphans.join(', ')}`));
  }

  // ---- 5. resources (PM651-004: declared intervals only; PM651-005: BigInt) ----
  const resourceResults = [];
  const windowsByRes = new Map();
  const overlapResources = new Set();
  for (const w of pkg.capacity_windows || []) {
    charge();
    if (!windowsByRes.has(w.resource_id)) windowsByRes.set(w.resource_id, []);
    windowsByRes.get(w.resource_id).push(w);
  }
  for (const [res, wins] of windowsByRes) {
    const sorted = [...wins].sort((a, b) => a.start_tick - b.start_tick);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start_tick < sorted[i - 1].end_tick) {
        findings.push(diag('CAPACITY_WINDOW_OVERLAP', SEVERITY.UNVERIFIABLE, sorted[i].window_id,
          `overlaps window ${sorted[i - 1].window_id} for resource ${res}`, 'window_id'));
        overlapResources.add(res);
      }
    }
  }
  // Demand intervals from DECLARED starts only (PM651-004). A task with no
  // declared_start_tick has no verifiable allocation -> UNVERIFIABLE basis.
  const demandsByRes = new Map();
  const unverifiableResources = new Set();
  for (const [id, t] of tasks) {
    for (const d of t.resource_demands || []) {
      charge();
      if (t.duration_ticks === 0) {
        if (d.amount_num !== 0) {
          findings.push(diag('ZERO_DURATION_DEMAND', SEVERITY.MISMATCH, id,
            'nonzero demand on zero-duration task', 'task_id'));
        }
        continue;
      }
      if (t.declared_start_tick === null || t.declared_start_tick === undefined) {
        // No declared allocation start -> cannot verify this demand.
        unverifiableResources.add(d.resource_id);
        findings.push(diag('RESOURCE_NO_DECLARED_START', SEVERITY.UNVERIFIABLE, id,
          `task ${id} has resource demand but no declared_start_tick`, 'task_id'));
        continue;
      }
      if (!demandsByRes.has(d.resource_id)) demandsByRes.set(d.resource_id, []);
      // PM651-005: exact declared interval end via BigInt. Refuse the
      // demand if the exact end exceeds MAX_SAFE_INTEGER.
      const declEnd = BigInt(t.declared_start_tick) + BigInt(t.duration_ticks);
      if (declEnd > BigInt(Number.MAX_SAFE_INTEGER)) {
        findings.push(diag('UNSAFE_TICK_ARITHMETIC', SEVERITY.BLOCKING_MATH, id,
          `declared interval end exceeds MAX_SAFE_INTEGER: ${declEnd}`, 'task_id'));
        unverifiableResources.add(d.resource_id);
        continue;
      }
      demandsByRes.get(d.resource_id).push({
        start: t.declared_start_tick,
        end: Number(declEnd),
        num: BigInt(d.amount_num), den: BigInt(d.amount_den), task_id: id,
      });
    }
  }
  const allResources = new Set([...demandsByRes.keys(), ...windowsByRes.keys(), ...unverifiableResources]);
  for (const res of [...allResources].sort()) {
    const demands = demandsByRes.get(res) || [];
    const wins = (windowsByRes.get(res) || []).sort((a, b) => a.start_tick - b.start_tick);
    if (unverifiableResources.has(res) && !demands.length) {
      resourceResults.push({ resource_id: res, assessment: 'UNVERIFIABLE', conflicts: [] });
      continue;
    }
    if (!demands.length) continue;
    // Overlapping capacity windows make the basis unverifiable (PM651-004).
    if (overlapResources.has(res)) {
      resourceResults.push({ resource_id: res, assessment: 'UNVERIFIABLE', conflicts: [] });
      continue;
    }
    const lo = Math.min(...demands.map((d) => d.start));
    const hi = Math.max(...demands.map((d) => d.end));
    // Coverage: only windows intersecting [lo,hi) matter; windows wholly
    // outside the demand interval are irrelevant (PM651-004 probe5).
    const relevant = wins.filter((w) => w.start_tick < hi && w.end_tick > lo);
    let covered = true;
    let cursor = lo;
    for (const w of relevant) {
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
    // Cutpoints from demand AND capacity boundaries (PM651-004).
    const cutSet = new Set();
    for (const d of demands) { cutSet.add(d.start); cutSet.add(d.end); }
    for (const w of wins) { cutSet.add(w.start_tick); cutSet.add(w.end_tick); }
    const cuts = [...cutSet].sort((a, b) => a - b);
    const conflicts = [];
    // Capacity as BigInt rational.
    const capRat = (w) => {
      const c = w.capacity;
      if (typeof c === 'number') return [BigInt(c), 1n];
      return [BigInt(c.num), BigInt(c.den)];
    };
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b <= a) continue;
      const active = demands.filter((d) => d.start <= a && a < d.end);
      if (!active.length) continue;
      // Exact BigInt sum, reduced each step.
      let num = 0n, den = 1n;
      for (const d of active) {
        num = num * d.den + d.num * den;
        den = den * d.den;
        const g = bigGcd(num, den);
        num /= g; den /= g;
      }
      // Capacity at cutpoint: the window containing a. If overlapping
      // windows both contain a, use the minimum (conservative) and the
      // overlap was already flagged UNVERIFIABLE above.
      const covering = wins.filter((x) => x.start_tick <= a && a < x.end_tick);
      if (!covering.length) continue; // gap already handled
      let capNum = null, capDen = 1n;
      for (const w of covering) {
        const [cn, cd] = capRat(w);
        if (capNum === null || cmpRat(cn, cd, capNum, capDen) < 0) { capNum = cn; capDen = cd; }
      }
      if (cmpRat(num, den, capNum, capDen) > 0) {
        conflicts.push({
          interval: [a, b],
          demand_num: num.toString(), demand_den: den.toString(),
          capacity_num: capNum.toString(), capacity_den: capDen.toString(),
          tasks: active.map((d) => d.task_id).sort(),
        });
      }
    }
    if (conflicts.length) {
      findings.push(diag('RESOURCE_OVERALLOCATION', SEVERITY.MISMATCH, null,
        `resource ${res} over capacity in ${conflicts.length} interval(s)`));
      resourceResults.push({ resource_id: res, assessment: 'OVERALLOCATED', conflicts });
    } else if (unverifiableResources.has(res)) {
      findings.push(diag('RESOURCE_BASIS_INCOMPLETE', SEVERITY.UNVERIFIABLE, null,
        `resource ${res} has unverifiable demand basis`));
      resourceResults.push({ resource_id: res, assessment: 'UNVERIFIABLE', conflicts: [] });
    } else {
      resourceResults.push({ resource_id: res, assessment: 'OK', conflicts: [] });
    }
  }

  // ---- 6. completion (PM651-006: verified only with host population) ----
  let completeCount = 0;
  for (const t of tasks.values()) if (t.status === 'COMPLETE') completeCount++;
  // Completion is verified ONLY if the host separately established the
  // population (expected_tasks matches the admitted task count) AND there
  // are no unverifiable findings. Absence of unrelated findings does not
  // prove the task list is the entire plan.
  const hasUnverifiable = findings.some((f) => f.severity === SEVERITY.UNVERIFIABLE);
  const popExpected = population && typeof population.expected_tasks === 'number'
    ? population.expected_tasks : null;
  const popMatches = popExpected !== null && popExpected === tasks.size;
  const completion = {
    complete: completeCount,
    total: tasks.size,
    ratio: tasks.size === 0 ? null : completeCount / tasks.size,
    ratio_defined: tasks.size !== 0,
    verified: popMatches && !hasUnverifiable && tasks.size > 0,
    population_declared: popExpected,
    population_matches: popMatches,
  };
  let header = null;
  if (pkg.header_claims && pkg.header_claims.claimed_completion_pct !== undefined && pkg.header_claims.claimed_completion_pct !== null) {
    const claimed = pkg.header_claims.claimed_completion_pct;
    // EXACT comparison (PM651-005): no epsilon. claimed is a number; compute
    // exact rational and compare.
    let match = false;
    let actualPct = null;
    if (tasks.size !== 0 && typeof claimed === 'number' && Number.isFinite(claimed)) {
      // Exact: completeCount/tasks.size*100 === claimed ?
      // Compare completeCount*100*D === claimed*N*D via decimal expansion.
      // Simplest exact: compare as rationals — claimed must be exactly
      // representable. We compare completeCount/tasks.size === claimed/100
      // via BigInt: completeCount*100 === claimed*tasks.size only if claimed
      // is an integer; otherwise use exact decimal parsing.
      const parsed = parseDecimalExact(String(claimed));
      if (parsed) {
        const [cn, cd] = parsed; // claimed = cn/cd
        // completeCount/tasks.size === cn/(cd*100) ?
        match = BigInt(completeCount) * cd * 100n === cn * BigInt(tasks.size);
        actualPct = (completeCount / tasks.size) * 100;
      }
    }
    header = { claimed_completion_pct: claimed, computed_pct: actualPct, match };
    if (!match) {
      findings.push(diag('HEADER_COMPLETION_MISMATCH', SEVERITY.MISMATCH, null,
        `header claims ${claimed}% but computed ${actualPct === null ? 'undefined' : actualPct + '%'}`));
    }
  }

  const blocking = findings.some((f) => f.severity === SEVERITY.BLOCKING_MATH);
  return {
    status: blocking ? 'PARTIAL' : 'REPORT_READY',
    math, findings, orphans, milestones: milestoneResults,
    resources: resourceResults, completion, header,
  };
}

/**
 * Find an actual deterministic cycle witness via DFS (PM651-010).
 * Returns the ordered cycle path [n0, n1, ..., n0] or null.
 * Distinguishes truly cyclic nodes from downstream-blocked nodes.
 */
function findCycleWitness(tasks, succs) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const id of tasks.keys()) color.set(id, WHITE);
  const stack = [];

  function dfs(id) {
    color.set(id, GRAY);
    stack.push(id);
    const neighbors = [...(succs.get(id) || [])].sort();
    for (const to of neighbors) {
      if (color.get(to) === GRAY) {
        // Found a cycle: from first occurrence of `to` to here, plus `to`.
        const startIdx = stack.indexOf(to);
        return [...stack.slice(startIdx), to];
      }
      if (color.get(to) === WHITE) {
        const result = dfs(to);
        if (result) return result;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const id of [...tasks.keys()].sort()) {
    if (color.get(id) === WHITE) {
      const result = dfs(id);
      if (result) return result;
    }
  }
  return null;
}

/** Parse a decimal string to exact [num, den] BigInt, or null if invalid. */
function parseDecimalExact(s) {
  const m = /^(-?\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s.trim());
  if (!m) return null;
  let num = BigInt(m[1]);
  let den = 1n;
  if (m[2]) {
    const frac = m[2];
    num = num * 10n ** BigInt(frac.length) + BigInt((num < 0n ? '-' : '') + frac);
    den = 10n ** BigInt(frac.length);
  }
  if (m[3]) {
    const exp = parseInt(m[3], 10);
    if (exp > 0) num *= 10n ** BigInt(exp);
    else den *= 10n ** BigInt(-exp);
  }
  return reduce(num, den);
}

function refused(reason, findings) {
  return {
    status: 'REFUSED', math: null,
    findings: [...findings, diag('INVALID_INPUT', 'high', null, reason)],
    orphans: [], milestones: [], resources: [], completion: null, header: null,
  };
}
