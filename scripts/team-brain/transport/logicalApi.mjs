// Team Brain P2 — role-scoped logical API dispatcher.
//
// Brief §4 lists the logical API surface and splits it into two tiers:
// ordinary agent operations reachable through a signed envelope
// (submit_task, append_evidence, submit_outcome, submit_verdict,
// get_queue, get_status, search_memory, get_receipt, propose_priority,
// propose_rule_change, propose_conflict_resolution), and a protected
// Jason-origin admin channel (apply_priority, revoke_authorization,
// apply_rule_change, resolve_conflict) that is explicitly "never general
// agent envelope permission."
//
// This module enforces that split STRUCTURALLY, not just via a grant
// check: ADMIN_ONLY operations are hard-blocked from ever reaching a
// handler through handleEnvelope, even if some grant in the registry
// would otherwise authorize the principal for that operation name. Admin
// actions go through the registry's own direct admin functions
// (registerKey, grantAuthorization, revokeKey, revokeAuthorization, with
// an explicit adminCtx) — never through this envelope pipeline. This
// mirrors the brief's "requests cannot select DB role, trusted identity
// table, policy root or result verification method" principle: the
// transport layer itself refuses to be the path, independent of what any
// single grant record says.
//
// P2 scope: this is the dispatch/authorization shell only. The actual
// obligation-ledger semantics behind submit_task/get_queue/etc. are P1's
// (ledger/repository.mjs, already merged) and P3's (orchestrator/queue)
// job — handlers are supplied by the caller, not implemented here.

import { verifyAndAuthorize } from "./registry.mjs";
import { fail, CODES } from "./errors.mjs";

export const AGENT_OPERATIONS = new Set([
  "submit_task",
  "append_evidence",
  "submit_outcome",
  "submit_verdict",
  "get_queue",
  "get_status",
  "search_memory",
  "get_receipt",
  "propose_priority",
  "propose_rule_change",
  "propose_conflict_resolution",
]);

export const ADMIN_ONLY_OPERATIONS = new Set([
  "apply_priority",
  "revoke_authorization",
  "apply_rule_change",
  "resolve_conflict",
]);

export function operationTier(operation) {
  if (ADMIN_ONLY_OPERATIONS.has(operation)) return "ADMIN_ONLY";
  if (AGENT_OPERATIONS.has(operation)) return "AGENT";
  return null;
}

// `handlers` is a plain object: { [operation]: (envelope, verifyResult) => result }.
// Only AGENT-tier operations may ever be registered here — registering an
// ADMIN_ONLY operation name is refused at construction time, not silently
// accepted and then blocked later, so the mistake is caught where it's
// made.
export function createApi(registry, handlers) {
  for (const op of Object.keys(handlers)) {
    if (ADMIN_ONLY_OPERATIONS.has(op)) {
      fail(
        CODES.ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN,
        `refusing to register an admin-only operation as an envelope handler: ${op}`,
        { operation: op }
      );
    }
    if (!AGENT_OPERATIONS.has(op)) {
      fail(CODES.UNKNOWN_OPERATION, `not a recognized logical API operation: ${op}`, { operation: op });
    }
  }
  return { registry, handlers: { ...handlers } };
}

// Verifies + authorizes the envelope (registry.verifyAndAuthorize - throws
// on any trust failure), THEN structurally refuses dispatch for an
// ADMIN_ONLY operation regardless of grants, THEN dispatches to the
// matching handler if one was registered.
//
// `expected` is an optional external pin, in verifyAndAuthorize's expected
// shape: { operation?, resource?: { repo, reviewed_head? } }.
//
// Head-binding honesty (Grok P2 fix): verifyAndAuthorize only enforces
// reviewed_head when an external expected resource is supplied. This
// dispatcher previously passed the envelope's own resource as the expected
// resource, so the head check compared the envelope to itself and could
// never fire. Now, when a caller supplies an external expected pin, it is
// passed through unchanged; when no external expected is supplied, no
// expected resource is passed at all. A dispatcher call without an
// external pin does NOT enforce head binding — signature, signer-binding,
// grant, and replay checks still run, but head binding is not claimed.
// A caller that enforces a pin (the P3 orchestrator, later) must supply
// it as this third argument.
export function handleEnvelope(api, envelope, expected) {
  const tier = operationTier(envelope.operation);
  if (tier === "ADMIN_ONLY") {
    fail(
      CODES.ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN,
      `${envelope.operation} is an admin-only operation and can never be reached through a signed envelope`,
      { operation: envelope.operation, principalId: envelope.principal_id }
    );
  }
  if (tier !== "AGENT") {
    fail(CODES.UNKNOWN_OPERATION, `not a recognized logical API operation: ${envelope.operation}`, {
      operation: envelope.operation,
    });
  }

  // verifyAndAuthorize itself checks checkAuthorized(principal, operation,
  // resource) - an agent grant naming an ADMIN_ONLY operation would (if
  // one ever existed) pass THAT check, which is exactly why the tier gate
  // above runs first and unconditionally, not as a fallback.
  //
  // Do NOT pass the envelope's own resource here as the expected resource:
  // that would compare the envelope to itself and falsely claim head
  // binding. Pass the caller's external expected through unchanged, or
  // nothing when no external pin was supplied.
  const verifyResult = verifyAndAuthorize(api.registry, envelope, expected);

  const handler = api.handlers[envelope.operation];
  if (!handler) {
    fail(CODES.UNKNOWN_OPERATION, `no handler registered for operation: ${envelope.operation}`, {
      operation: envelope.operation,
    });
  }
  return handler(envelope, verifyResult);
}
