// Semantic target registry (FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md Section 12.B): guidance must point at a
// stable identifier, never a CSS selector or DOM position. Two distinct failure modes get two distinct
// treatments, matching the design doc's own split ("must detect missing, duplicate, or unreachable targets
// during testing" vs. "handle a missing target safely by stopping guidance... not by guessing"):
//
//   - A DUPLICATE targetId is an authoring mistake in a workflow/registry definition -- it can only be
//     caught by a human or a test, so registry construction fails closed (throws) rather than silently
//     picking one of the two.
//   - A MISSING targetId at lookup time is an expected runtime possibility (a step references a target
//     that doesn't apply this session, or the DOM element genuinely isn't mounted) -- resolution must never
//     throw; it returns a safe "not found" result so the caller can stop guidance gracefully.

import { validateSemanticTarget, MalformedGuidedWorkflowContractError } from "./guidedWorkflowContracts.js";

export function createSemanticTargetRegistry(targets) {
  if (!Array.isArray(targets)) {
    throw new MalformedGuidedWorkflowContractError("SemanticTargetRegistry", "targets must be an array");
  }

  const byId = new Map();

  for (const rawTarget of targets) {
    const target = validateSemanticTarget(rawTarget);
    if (byId.has(target.targetId)) {
      throw new MalformedGuidedWorkflowContractError(
        "SemanticTargetRegistry",
        `duplicate targetId "${target.targetId}"`,
      );
    }
    byId.set(target.targetId, target);
  }

  return Object.freeze({
    has(targetId) {
      return byId.has(targetId);
    },
    get(targetId) {
      return byId.get(targetId) || null;
    },
    list() {
      return Object.freeze([...byId.values()]);
    },
  });
}

// Never throws -- a missing target is an expected, safely-handled outcome (see file header), not an
// exceptional one. Callers (the session controller, the coach overlay) branch on `.found` and stop
// guidance rather than propagate an error.
export function resolveSemanticTarget(registry, targetId) {
  if (!registry || typeof registry.has !== "function") {
    return Object.freeze({ found: false, reason: "invalid_registry", target: null });
  }
  if (typeof targetId !== "string" || targetId.trim().length === 0) {
    return Object.freeze({ found: false, reason: "invalid_target_id", target: null });
  }
  if (!registry.has(targetId)) {
    return Object.freeze({ found: false, reason: "missing_target", target: null });
  }
  return Object.freeze({ found: true, reason: null, target: registry.get(targetId) });
}
