// Pure, framework-agnostic circular-dependency diagnosis for the relational scheduling schema --
// SCHED-11. schedulingCpmEngine.js's topologicalOrder already DETECTS a cycle (cyclicBlockIds, the
// set of blocks caught in or downstream of one) and detectConflicts already surfaces it as a
// conflict -- but only as "these N blocks are affected," with no trace of which specific links form
// the loop or which one to remove. This module adds that: the actual cycle path, and a ranked
// suggestion for which single link is most likely the mistake. Not an auto-fix -- the user still
// confirms via the existing removeDependency board action; see the module comment on
// suggestCycleBreak for why no edge is ever removed automatically.
//
// This is exactly the kind of deterministic, independently-tested service the planned end-user
// layer of Forge Brain (the existing developer-facing Engineering Brain's long-term evolution into
// a cross-application assistant) should eventually call rather than reimplement -- see the project's
// own memory on this distinction. Nothing here depends on that layer existing; it's a standalone,
// directly-wireable capability today.

import { topologicalOrder } from "./schedulingCpmEngine";

// Standard cycle-extraction via DFS back-edges, iterative (not recursive) so a pathological huge
// cyclic input can't blow the JS call stack -- same guard-conscious spirit as this module family's
// MAX_CALENDAR_WALK_DAYS-style guards elsewhere, just shaped for a graph walk instead of a date walk.
// White = unvisited, gray = on the current path (in `stack`), black = fully explored (a black node
// can never be part of a NEW cycle -- DAG-safe to skip). A back-edge (gray -> gray) closes exactly
// one cycle, reconstructed from `stack`'s current contents.
function findCyclesInSubgraph(nodeIds, adjacency) {
  const color = new Map([...nodeIds].map((id) => [id, "white"]));
  const cycles = [];

  for (const startId of nodeIds) {
    if (color.get(startId) !== "white") continue;
    const stack = [{ nodeId: startId, edgeIndex: 0 }];
    color.set(startId, "gray");

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adjacency.get(frame.nodeId) ?? [];
      if (frame.edgeIndex < neighbors.length) {
        const next = neighbors[frame.edgeIndex];
        frame.edgeIndex += 1;
        const nextColor = color.get(next);
        if (nextColor === "white") {
          color.set(next, "gray");
          stack.push({ nodeId: next, edgeIndex: 0 });
        } else if (nextColor === "gray") {
          const pathNodeIds = stack.map((f) => f.nodeId);
          const startIndex = pathNodeIds.indexOf(next);
          cycles.push([...pathNodeIds.slice(startIndex), next]);
        }
      } else {
        color.set(frame.nodeId, "black");
        stack.pop();
      }
    }
  }
  return cycles;
}

// Traces the actual loop(s) among topologicalOrder's cyclicBlockIds -- which, per its own
// definition, includes both genuine cycle members AND anything merely downstream of one (blocked
// from ever ordering, but not itself looping). Only nodes with a real back-edge ever appear in an
// extracted cycle; a downstream-only node is explored and marked black without producing one, so
// including it in the search set is harmless, not a source of false positives.
export function traceCycle({ blocks, dependencies }) {
  const { cyclicBlockIds, validDependencies } = topologicalOrder(blocks, dependencies);
  if (cyclicBlockIds.size === 0) return Object.freeze([]);

  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const adjacency = new Map([...cyclicBlockIds].map((id) => [id, []]));
  const edgeByPair = new Map();
  for (const dependency of validDependencies) {
    if (!cyclicBlockIds.has(dependency.predecessor_id) || !cyclicBlockIds.has(dependency.successor_id)) continue;
    adjacency.get(dependency.predecessor_id).push(dependency.successor_id);
    edgeByPair.set(`${dependency.predecessor_id} ${dependency.successor_id}`, dependency);
  }

  const rawCycles = findCyclesInSubgraph(cyclicBlockIds, adjacency);

  // Dedupe: a graph with multiple entry points into the same loop can have the DFS rediscover it
  // starting from a different node -- the resulting path is a rotation of the same cycle, not a
  // second distinct one. Keyed by the sorted set of edge ids involved (order/start-point-independent),
  // not the path array itself.
  const seenEdgeSets = new Set();
  const cycles = [];
  for (const path of rawCycles) {
    const edges = [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const dependency = edgeByPair.get(`${path[i]} ${path[i + 1]}`);
      // predecessor/successor_task_code are added for display -- callers (e.g. the board UI) show
      // these, never the raw relational block ids, which mean nothing to a user and (for a route
      // that namespaces ids per-project, like this app's board hydration) may not even be the id
      // shape the caller's other data uses.
      edges.push(Object.freeze({ ...dependency, predecessor_task_code: blocksById.get(dependency.predecessor_id)?.task_code ?? dependency.predecessor_id, successor_task_code: blocksById.get(dependency.successor_id)?.task_code ?? dependency.successor_id }));
    }
    const key = edges.map((edge) => edge.id).sort().join(",");
    if (seenEdgeSets.has(key)) continue;
    seenEdgeSets.add(key);
    cycles.push(Object.freeze({
      taskCodes: Object.freeze(path.map((id) => blocksById.get(id)?.task_code ?? id)),
      edges: Object.freeze(edges),
    }));
  }
  return Object.freeze(cycles);
}

// Ranks the edges of ONE traced cycle by how likely each is to be the modeling mistake that created
// the loop, most-suspect first -- comparator, not a single numeric score, since "most recently
// added" (a date) and "unusual relationship type" aren't naturally combinable into one number
// without an arbitrary weighting this module has no basis to assert.
//
// 1. A non-FS relationship (SS/FF/SF) is more suspect than FS -- Finish-to-Start is the overwhelming
//    norm (DCMA point 4 itself expects >=90% FS), so a non-FS link inside a loop stands out.
// 2. A lead (negative lag) is more suspect than a lag or no lag -- DCMA point 2 already treats any
//    lead as bad practice, and a lead is exactly the kind of "let me just make this start a bit
//    earlier" edit that can accidentally close a loop.
// 3. Among remaining ties, the most recently created edge -- more likely to be the just-added link
//    that closed an otherwise-fine chain than an edge that's been there all along. Skipped entirely
//    if created_at isn't present on the input rows (e.g. a client-side caller with no timestamp).
// 4. Final tie-break: dependency id, for determinism.
function compareSuspicion(a, b) {
  const aNonFs = a.relationship_type === "FS" ? 0 : 1;
  const bNonFs = b.relationship_type === "FS" ? 0 : 1;
  if (aNonFs !== bNonFs) return bNonFs - aNonFs;

  const aLead = a.lag_days < 0 ? 1 : 0;
  const bLead = b.lag_days < 0 ? 1 : 0;
  if (aLead !== bLead) return bLead - aLead;

  if (a.created_at && b.created_at && a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
  return a.id.localeCompare(b.id);
}

function reasonFor(edge, runnerUp) {
  if (edge.relationship_type !== "FS") {
    return `This is a ${edge.relationship_type} relationship -- the rest of this loop (and most schedules) uses Finish-to-Start, so a non-FS link is the likeliest modeling mistake.`;
  }
  if (edge.lag_days < 0) {
    return `This link has a lead of ${Math.abs(edge.lag_days)} day(s) (negative lag) -- leads are unusual and a common way to accidentally close a loop.`;
  }
  if (edge.created_at && (!runnerUp || edge.created_at !== runnerUp.created_at)) {
    return "This is the most recently added link in the loop, and otherwise looks like every other link here -- most likely the one that closed it.";
  }
  return "No link in this loop stands out structurally (all plain Finish-to-Start, no leads) -- this one was picked only to break the tie deterministically.";
}

// Not an auto-fix: returns a suggestion for a human to confirm, same as every other conflict this
// codebase surfaces (over-allocation warnings, DCMA failures) -- removing a dependency changes the
// schedule's actual logic, which this module has no authority to decide is correct unilaterally.
export function suggestCycleBreak(cycle) {
  if (!cycle || cycle.edges.length === 0) return null;
  const ranked = [...cycle.edges].sort(compareSuspicion);
  return Object.freeze({ dependency: ranked[0], reason: reasonFor(ranked[0], ranked[1]) });
}

// Single entry point for a wiring layer: traces every cycle and attaches a ranked suggestion to
// each, in one call.
export function diagnoseCycles({ blocks, dependencies }) {
  return Object.freeze(traceCycle({ blocks, dependencies }).map((cycle) => Object.freeze({ ...cycle, suggestion: suggestCycleBreak(cycle) })));
}
