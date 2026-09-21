// FORGE Chart Builder — connect mode (slice 4.4).
// Pure helper that turns two clicked cards into a reducer action. Org charts
// reparent the target under the source (the reducer rejects cycles and its
// message surfaces); workflow charts gain a sequence edge (an identical
// from→to edge is refused up front so chain-building never double-links).

import { WORKFLOW_EDGE_TYPES, getNode } from "./chartDocument.js";

const WORKFLOW_CONNECT_EDGE_TYPE = WORKFLOW_EDGE_TYPES[0];

function nextConnectEdgeId(doc, sourceId, targetId) {
  const taken = new Set((doc.edges ?? []).map((e) => e.id));
  const base = `edge-${sourceId}-${targetId}`;
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/**
 * Build the reducer action that connects sourceId → targetId.
 * @returns {{ action: object } | { error: string }}
 */
export function buildConnectAction(doc, sourceId, targetId) {
  if (!doc || !Array.isArray(doc.nodes)) {
    return { error: "There is no chart to connect." };
  }
  const source = getNode(doc, sourceId);
  const target = getNode(doc, targetId);
  if (!source || !target) {
    return { error: "One of those cards no longer exists." };
  }
  if (sourceId === targetId) {
    return { error: "A card can't connect to itself." };
  }
  if (doc.type === "org") {
    return {
      action: { type: "REPARENT_NODE", nodeId: targetId, newSupervisorId: sourceId },
    };
  }
  const duplicate = (doc.edges ?? []).some(
    (e) => e.from === sourceId && e.to === targetId
  );
  if (duplicate) {
    return { error: "Those steps are already connected." };
  }
  return {
    action: {
      type: "ADD_EDGE",
      edge: {
        id: nextConnectEdgeId(doc, sourceId, targetId),
        from: sourceId,
        to: targetId,
        type: WORKFLOW_CONNECT_EDGE_TYPE,
      },
    },
  };
}
