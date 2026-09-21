// FORGE Chart Builder — pure chart reducer (slice 1).
// All actions are immutable: the incoming document is never mutated.
// Convention: chartReducer(state, action) returns { state, error } where
// error is null on success and a string on rejection (state is then the
// input state unchanged).

import { ChartError, createEdge, createNode, getEdge, getNode, withParts } from "./chartDocument.js";

export const CHART_ACTIONS = Object.freeze([
  "ADD_NODE",
  "DELETE_NODE",
  "UPDATE_NODE",
  "MOVE_NODE",
  "ADD_EDGE",
  "DELETE_EDGE",
  "REPARENT_NODE",
]);

function ok(state) {
  return { state, error: null };
}

function fail(state, error) {
  return { state, error };
}

function ensureNode(node) {
  // Always normalize through the constructor so partially trusted objects
  // with an id/label but invalid position, fields, or style are validated.
  return createNode(node ?? {});
}

function ensureEdge(edge) {
  return createEdge(edge ?? {});
}

function replaceNode(nodes, id, fn) {
  return nodes.map((n) => (n.id === id ? fn(n) : n));
}

function outgoingEdges(edges, nodeId) {
  return edges.filter((e) => e.from === nodeId);
}

function incomingEdges(edges, nodeId) {
  return edges.filter((e) => e.to === nodeId);
}

// True when `descendantId` is reachable from `ancestorId` by following
// supervisor edges (org trees only). Used to reject cycles before applying
// REPARENT_NODE.
export function isSupervisorDescendant(doc, ancestorId, descendantId) {
  if (ancestorId === descendantId) return true;
  const visited = new Set();
  const stack = [ancestorId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === descendantId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of doc.edges) {
      if (edge.from === current && (edge.type === "supervisor" || edge.type === "")) {
        stack.push(edge.to);
      }
    }
  }
  return false;
}

function doAddNode(state, action) {
  const node = ensureNode(action.node);
  if (getNode(state, node.id)) {
    return fail(state, `node id "${node.id}" already exists`);
  }
  return ok(withParts(state, { nodes: [...state.nodes, node] }));
}

function doDeleteNode(state, action) {
  const id = action.id;
  if (!getNode(state, id)) {
    return fail(state, `unknown node id "${id}"`);
  }
  // Edge cleanup: every edge touching the node leaves with it.
  const edges = state.edges.filter((e) => e.from !== id && e.to !== id);
  const nodes = state.nodes.filter((n) => n.id !== id);
  return ok(withParts(state, { nodes, edges }));
}

function doUpdateNode(state, action) {
  const node = getNode(state, action.id);
  if (!node) {
    return fail(state, `unknown node id "${action.id}"`);
  }
  const patch = action.patch ?? {};
  const updated = {
    ...node,
    label: patch.label !== undefined ? patch.label : node.label,
    subtitle: patch.subtitle !== undefined ? patch.subtitle : node.subtitle,
    fields: patch.fields !== undefined ? { ...node.fields, ...patch.fields } : node.fields,
    position:
      patch.position !== undefined
        ? { ...node.position, ...patch.position }
        : node.position,
    style: patch.style !== undefined ? { ...node.style, ...patch.style } : node.style,
  };
  try {
    const validated = createNode({
      id: updated.id,
      label: updated.label,
      subtitle: updated.subtitle,
      fields: updated.fields,
      position: updated.position,
      style: updated.style,
    });
    return ok(withParts(state, { nodes: replaceNode(state.nodes, node.id, () => validated) }));
  } catch (err) {
    if (err instanceof ChartError) return fail(state, err.message);
    throw err;
  }
}

function doMoveNode(state, action) {
  const node = getNode(state, action.id);
  if (!node) {
    return fail(state, `unknown node id "${action.id}"`);
  }
  const position = action.position ?? {};
  if (
    typeof position.x !== "number" ||
    typeof position.y !== "number" ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return fail(state, "MOVE_NODE position must be { x: finite number, y: finite number }");
  }
  const moved = Object.freeze({ ...node, position: Object.freeze({ x: position.x, y: position.y }) });
  return ok(withParts(state, { nodes: replaceNode(state.nodes, node.id, () => moved) }));
}

function doAddEdge(state, action) {
  const edge = ensureEdge(action.edge);
  if (getEdge(state, edge.id)) {
    return fail(state, `edge id "${edge.id}" already exists`);
  }
  if (!getNode(state, edge.from)) {
    return fail(state, `edge from "${edge.from}" is not a known node`);
  }
  if (!getNode(state, edge.to)) {
    return fail(state, `edge to "${edge.to}" is not a known node`);
  }
  if (state.type === "org") {
    const supervisorType = edge.type === "" ? "supervisor" : edge.type;
    if (supervisorType !== "supervisor") {
      return fail(state, `org edges must be type "supervisor" (got "${edge.type}")`);
    }
    const normalized = Object.freeze({ ...edge, type: "supervisor" });
    if (isSupervisorDescendant(state, edge.to, edge.from)) {
      return fail(state, `org edge ${edge.from} -> ${edge.to} would create a cycle`);
    }
    return ok(withParts(state, { edges: [...state.edges, normalized] }));
  }
  return ok(withParts(state, { edges: [...state.edges, edge] }));
}

function doDeleteEdge(state, action) {
  if (!getEdge(state, action.id)) {
    return fail(state, `unknown edge id "${action.id}"`);
  }
  return ok(withParts(state, { edges: state.edges.filter((e) => e.id !== action.id) }));
}

function doReparentNode(state, action) {
  if (state.type !== "org") {
    return fail(state, "REPARENT_NODE applies to org documents only");
  }
  const node = getNode(state, action.nodeId);
  if (!node) {
    return fail(state, `unknown node id "${action.nodeId}"`);
  }
  const supervisor = getNode(state, action.newSupervisorId);
  if (!supervisor) {
    return fail(state, `unknown supervisor id "${action.newSupervisorId}"`);
  }
  if (action.nodeId === action.newSupervisorId) {
    return fail(state, "a node cannot supervise itself");
  }
  // Validate before applying: reparenting under one of the node's own
  // descendants would create a cycle.
  if (isSupervisorDescendant(state, action.nodeId, action.newSupervisorId)) {
    return fail(
      state,
      `reparenting "${action.nodeId}" under "${action.newSupervisorId}" would create a cycle`
    );
  }
  // Swap the single incoming supervisor edge for the new one. A node being
  // reparented into a fresh tree has no incoming supervisor edge yet.
  const edges = state.edges.filter(
    (e) => !(e.to === action.nodeId && (e.type === "supervisor" || e.type === ""))
  );
  const newEdge = createEdge({
    id: nextFreeEdgeId(state, action.edgeId ?? `${action.newSupervisorId}->${action.nodeId}`),
    from: action.newSupervisorId,
    to: action.nodeId,
    label: action.edgeLabel ?? "",
    type: "supervisor",
  });
  return ok(withParts(state, { edges: [...edges, newEdge] }));
}

// Derives a collision-free edge id: a default or caller-supplied id that is
// already taken gets a numeric suffix instead of failing the reparent.
function nextFreeEdgeId(state, baseId) {
  if (!getEdge(state, baseId)) return baseId;
  let n = 2;
  while (getEdge(state, `${baseId}#${n}`)) n++;
  return `${baseId}#${n}`;
}

export function chartReducer(state, action) {
  if (!state || typeof state !== "object" || !Array.isArray(state.nodes)) {
    throw new ChartError("chartReducer requires a ChartDocument as state");
  }
  if (!action || typeof action.type !== "string") {
    throw new ChartError("chartReducer requires an action with a string type");
  }
  try {
    switch (action.type) {
      case "ADD_NODE":
        return doAddNode(state, action);
      case "DELETE_NODE":
        return doDeleteNode(state, action);
      case "UPDATE_NODE":
        return doUpdateNode(state, action);
      case "MOVE_NODE":
        return doMoveNode(state, action);
      case "ADD_EDGE":
        return doAddEdge(state, action);
      case "DELETE_EDGE":
        return doDeleteEdge(state, action);
      case "REPARENT_NODE":
        return doReparentNode(state, action);
      default:
        return fail(state, `unknown action type "${action.type}"`);
    }
  } catch (err) {
    if (err instanceof ChartError) return fail(state, err.message);
    throw err;
  }
}

// Convenience readers (pure, no state changes).
export function nodeChildren(doc, nodeId) {
  return outgoingEdges(doc.edges, nodeId)
    .filter((e) => doc.type !== "org" || e.type === "supervisor")
    .map((e) => getNode(doc, e.to))
    .filter(Boolean);
}

export function nodeSupervisor(doc, nodeId) {
  if (doc.type !== "org") return null;
  const incoming = incomingEdges(doc.edges, nodeId).filter((e) => e.type === "supervisor");
  return incoming.length > 0 ? getNode(doc, incoming[0].from) : null;
}
