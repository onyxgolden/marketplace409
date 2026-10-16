/**
 * graph.js — bounded structural validation of the snapshot node graph.
 *
 * DOM-003: the schema layer checks child existence and same-frame
 * parentage, but never acyclicity, single parentage, or root validity.
 * This module runs BEFORE any distillation work:
 *
 *   1. every frame root_ref exists AND belongs to the declaring frame
 *      (unknown or cross-frame roots refuse — they were previously
 *      silently ignored);
 *   2. every node has at most one parent (multi-parent associations are
 *      ambiguous — last-writer-wins is not a contract — so they refuse);
 *   3. the graph is acyclic (iterative DFS; cycles refuse instead of
 *      hanging nearestContext);
 *   4. every node is reachable from some declared root (disconnected
 *      nodes refuse — no silent partial coverage);
 *   5. traversal depth is capped at MAX_GRAPH_DEPTH (documented bound;
 *      deeper graphs refuse with a named reason instead of risking
 *      stack exhaustion in any recursive consumer).
 *
 * All traversal here is iterative with an explicit stack. Unknown or
 * ambiguous graphs yield a thrown Error whose message names the
 * violation; distillSnapshot converts that into
 * { status: "REFUSED", reason: "INVALID_GRAPH", detail } — never a hang,
 * never a partial map.
 *
 * Pure Node 24 ESM. Deterministic.
 */

export const MAX_GRAPH_DEPTH = 2048;

/**
 * Validate the node graph. Returns the parentOf map (child ref -> parent
 * ref) for the distiller to reuse.
 * @param {Array} frames — validated frame objects { frame_id, root_refs }
 * @param {Map} nodes — validated Map<ref, node>
 * @throws Error("graph: ...") naming the violation
 */
export function validateGraph(frames, nodes) {
  // 1. Roots exist and belong to the declaring frame.
  for (const f of frames) {
    for (const r of f.root_refs) {
      const n = nodes.get(r);
      if (!n) {
        throw new Error(`graph: frame ${JSON.stringify(f.frame_id)}: unknown root_ref ${JSON.stringify(r)}`);
      }
      if (n.frame_id !== f.frame_id) {
        throw new Error(
          `graph: frame ${JSON.stringify(f.frame_id)}: root_ref ${JSON.stringify(r)} ` +
          `belongs to frame ${JSON.stringify(n.frame_id)}`
        );
      }
    }
  }

  // 2. Single parentage.
  const parentOf = new Map();
  for (const n of nodes.values()) {
    for (const c of n.children) {
      if (parentOf.has(c)) {
        throw new Error(
          `graph: node ${JSON.stringify(c)} has multiple parents ` +
          `(${JSON.stringify(parentOf.get(c))}, ${JSON.stringify(n.ref)}) — ambiguous parentage refused`
        );
      }
      parentOf.set(c, n.ref);
    }
  }

  // 3+4. Iterative DFS from every root: cycle detection, depth cap,
  // reachability. (Dangling child refs are already impossible: schema
  // validation rejects them before this runs.)
  const UNVISITED = 0;
  const IN_STACK = 1;
  const DONE = 2;
  const color = new Map();
  for (const r of nodes.keys()) color.set(r, UNVISITED);

  for (const f of frames) {
    for (const root of f.root_refs) {
      if (color.get(root) !== UNVISITED) continue;
      color.set(root, IN_STACK);
      const stack = [{ ref: root, nextChild: 0, depth: 0 }];
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.depth > MAX_GRAPH_DEPTH) {
          throw new Error(`graph: traversal depth exceeds cap ${MAX_GRAPH_DEPTH} at ${JSON.stringify(top.ref)}`);
        }
        const node = nodes.get(top.ref);
        if (top.nextChild < node.children.length) {
          const c = node.children[top.nextChild];
          top.nextChild += 1;
          const cc = color.get(c);
          if (cc === IN_STACK) {
            throw new Error(`graph: cycle detected involving ${JSON.stringify(c)}`);
          }
          if (cc === UNVISITED) {
            color.set(c, IN_STACK);
            stack.push({ ref: c, nextChild: 0, depth: top.depth + 1 });
          }
          // DONE nodes are simply skipped (single parentage was already
          // enforced above, so re-encounter is impossible; this is defense).
        } else {
          color.set(top.ref, DONE);
          stack.pop();
        }
      }
    }
  }

  // 5. Disconnected nodes: reachable-from-roots is the coverage contract.
  for (const [r, c] of color) {
    if (c === UNVISITED) {
      throw new Error(`graph: node ${JSON.stringify(r)} is not reachable from any frame root — disconnected coverage refused`);
    }
  }

  return parentOf;
}
