// FORGE Chart Builder — canvas interaction helpers (slice 2).
// The one code path the canvas uses for pointer drops. Pure functions so the
// UI and the tests exercise exactly the same logic.
//
// resolveCanvasDrop(doc, { nodeId, position, dropTargetId }):
//   - org document + a drop target that is a different node -> attempt
//     REPARENT_NODE through the reducer, which rejects cycles. A rejected
//     reparent returns the ORIGINAL document state unchanged (the node's
//     position must not move); the rejection reason comes back as
//     reparentError and the caller surfaces it as an error notice only.
//   - otherwise -> MOVE_NODE to the dropped position.
// Returns { state, error, reparented, reparentError } where error is the
// MOVE_NODE outcome and reparentError carries a rejected reparent reason.

import { chartReducer } from "./chartReducer.js";

export function resolveCanvasDrop(doc, { nodeId, position, dropTargetId } = {}) {
  if (!doc || typeof nodeId !== "string") {
    throw new Error("resolveCanvasDrop requires a document and nodeId");
  }

  if (doc.type === "org" && dropTargetId && dropTargetId !== nodeId) {
    const reparent = chartReducer(doc, {
      type: "REPARENT_NODE",
      nodeId,
      newSupervisorId: dropTargetId,
    });
    if (!reparent.error) {
      return {
        state: reparent.state,
        error: null,
        reparented: true,
        reparentError: null,
      };
    }
    // Rejected (unknown node, self-parent, or cycle): return the original
    // document untouched. The node's position must be unchanged after a
    // rejected drop — the caller surfaces reparentError as a notice only.
    return {
      state: doc,
      error: null,
      reparented: false,
      reparentError: reparent.error,
    };
  }

  const moved = chartReducer(doc, {
    type: "MOVE_NODE",
    id: nodeId,
    position,
  });
  return {
    state: moved.state,
    error: moved.error,
    reparented: false,
    reparentError: null,
  };
}
