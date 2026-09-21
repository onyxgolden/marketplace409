// FORGE Chart Builder — document validation (slice 1).
// Pure functions. Both validators return:
//   { valid: boolean, errors: [{ type, severity, message, nodeId?, edgeId? }] }
// Severity is "error" (valid === false) or "warning" (valid can stay true).
// Orphans and disconnected nodes are REPORTED, never silently attached.

export const ORG_ERROR_TYPES = Object.freeze([
  "duplicate-node-id",
  "duplicate-label",
  "missing-node",
  "missing-supervisor",
  "multiple-supervisors",
  "cycle",
  "orphan",
]);

export const WORKFLOW_ERROR_TYPES = Object.freeze([
  "duplicate-node-id",
  "missing-node",
  "no-start-node",
  "disconnected-node",
]);

function isSupervisorEdge(edge) {
  return edge.type === "supervisor" || edge.type === "";
}

function incomingByNode(edges, predicate) {
  const map = new Map();
  for (const edge of edges) {
    if (predicate && !predicate(edge)) continue;
    if (!map.has(edge.to)) map.set(edge.to, []);
    map.get(edge.to).push(edge);
  }
  return map;
}

function outgoingByNode(edges, predicate) {
  const map = new Map();
  for (const edge of edges) {
    if (predicate && !predicate(edge)) continue;
    if (!map.has(edge.from)) map.set(edge.from, []);
    map.get(edge.from).push(edge);
  }
  return map;
}

// Depth-first cycle detection over supervisor edges. Returns an array of
// cycles, each cycle an array of node ids (closed loop, last === first).
function findSupervisorCycles(nodeIds, edges) {
  const children = new Map();
  for (const id of nodeIds) children.set(id, []);
  for (const edge of edges) {
    if (!isSupervisorEdge(edge)) continue;
    if (children.has(edge.from) && children.has(edge.to)) {
      children.get(edge.from).push(edge.to);
    }
  }
  const cycles = [];
  const state = new Map(); // id -> "visiting" | "done"
  const stack = [];
  function visit(id) {
    state.set(id, "visiting");
    stack.push(id);
    for (const child of children.get(id)) {
      if (state.get(child) === "visiting") {
        cycles.push([...stack.slice(stack.indexOf(child)), child]);
      } else if (!state.has(child)) {
        visit(child);
      }
    }
    stack.pop();
    state.set(id, "done");
  }
  for (const id of nodeIds) {
    if (!state.has(id)) visit(id);
  }
  return cycles;
}

function checkDuplicateNodeIds(doc, push) {
  const seen = new Set();
  for (const node of doc.nodes) {
    if (seen.has(node.id)) {
      push({ type: "duplicate-node-id", severity: "error", nodeId: node.id, message: `duplicate node id "${node.id}"` });
    } else {
      seen.add(node.id);
    }
  }
}

function checkEdgeEndpoints(doc, push) {
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const edge of doc.edges) {
    for (const [role, ref] of [["from", edge.from], ["to", edge.to]]) {
      if (!ids.has(ref)) {
        push({
          type: "missing-node",
          severity: "error",
          edgeId: edge.id,
          message: `edge "${edge.id}" ${role} references unknown node "${ref}"`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Org charts: a forest of trees.
// ---------------------------------------------------------------------------

export function validateOrgDocument(doc) {
  const errors = [];
  const push = (e) => errors.push(e);

  if (!doc || doc.type !== "org") {
    return { valid: false, errors: [{ type: "missing-node", severity: "error", message: "validateOrgDocument requires an org ChartDocument" }] };
  }

  checkDuplicateNodeIds(doc, push);
  checkEdgeEndpoints(doc, push);

  const nodeIds = doc.nodes.map((n) => n.id);
  const incomingSupervisor = incomingByNode(doc.edges, isSupervisorEdge);
  const outgoingSupervisor = outgoingByNode(doc.edges, isSupervisorEdge);

  // Exactly-one-incoming-supervisor-edge per non-root node.
  for (const id of nodeIds) {
    const incoming = incomingSupervisor.get(id) ?? [];
    if (incoming.length > 1) {
      push({
        type: "multiple-supervisors",
        severity: "error",
        nodeId: id,
        message: `node "${id}" has ${incoming.length} supervisor edges; exactly one is allowed`,
      });
    }
    // A "missing supervisor" is an incoming supervisor edge whose supervisor
    // node does not exist. The node itself is fine — its supervisor is the
    // thing that is missing.
    for (const edge of incoming) {
      if (!nodeIds.includes(edge.from)) {
        push({
          type: "missing-supervisor",
          severity: "error",
          nodeId: id,
          edgeId: edge.id,
          message: `node "${id}" reports to missing supervisor "${edge.from}" (edge "${edge.id}")`,
        });
      }
    }
  }

  // Cycles are never valid in an org tree.
  for (const cycle of findSupervisorCycles(nodeIds, doc.edges)) {
    push({
      type: "cycle",
      severity: "error",
      message: `supervisor cycle detected: ${cycle.join(" -> ")}`,
    });
  }

  // Duplicate display labels make the chart ambiguous; flag them.
  const labelCount = new Map();
  for (const node of doc.nodes) {
    const key = node.label.trim().toLowerCase();
    labelCount.set(key, (labelCount.get(key) ?? 0) + 1);
  }
  for (const node of doc.nodes) {
    const key = node.label.trim().toLowerCase();
    if (labelCount.get(key) > 1) {
      push({
        type: "duplicate-label",
        severity: "error",
        nodeId: node.id,
        message: `duplicate label "${node.label}" on node "${node.id}"`,
      });
    }
  }

  // Orphans: nodes with no supervisor connectivity at all — no incoming
  // supervisor edge and no outgoing supervisor edge. Reported as warnings —
  // never silently attached to any tree. Non-supervisor edges (or none) do
  // not count: only the supervisor hierarchy determines orphan status.
  for (const id of nodeIds) {
    const inCount = (incomingSupervisor.get(id) ?? []).length;
    const outCount = (outgoingSupervisor.get(id) ?? []).length;
    if (inCount === 0 && outCount === 0) {
      push({
        type: "orphan",
        severity: "warning",
        nodeId: id,
        message: `node "${id}" is an orphan: no supervisor edges; it was not attached to any tree`,
      });
    }
  }

  return { valid: !errors.some((e) => e.severity === "error"), errors };
}

// ---------------------------------------------------------------------------
// Workflow charts: cycles allowed, but the chart must have a start.
// ---------------------------------------------------------------------------

export function validateWorkflowDocument(doc) {
  const errors = [];
  const push = (e) => errors.push(e);

  if (!doc || doc.type !== "workflow") {
    return { valid: false, errors: [{ type: "missing-node", severity: "error", message: "validateWorkflowDocument requires a workflow ChartDocument" }] };
  }

  checkDuplicateNodeIds(doc, push);
  checkEdgeEndpoints(doc, push);

  const incomingAll = incomingByNode(doc.edges);

  // A workflow needs at least one start node (no incoming edges).
  const startNodes = doc.nodes.filter((n) => (incomingAll.get(n.id) ?? []).length === 0);
  if (startNodes.length === 0 && doc.nodes.length > 0) {
    push({
      type: "no-start-node",
      severity: "error",
      message: "workflow has no start node: every node has at least one incoming edge",
    });
  }

  // Disconnected nodes (no edges at all) are warnings, not errors.
  for (const node of doc.nodes) {
    const hasEdges = doc.edges.some((e) => e.from === node.id || e.to === node.id);
    if (!hasEdges) {
      push({
        type: "disconnected-node",
        severity: "warning",
        nodeId: node.id,
        message: `node "${node.id}" is disconnected: it has no edges`,
      });
    }
  }

  return { valid: !errors.some((e) => e.severity === "error"), errors };
}
