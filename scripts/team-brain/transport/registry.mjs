// Team Brain P2 — key/authority registry adapter + envelope verification
// pipeline that composes envelope.mjs with trust state.
//
// Brief §3 principal_keys / trusted_authorizations, §4 trust rules. This is
// the synthetic/in-memory adapter for P2 (no DB, no network — "Synthetic
// local Git + mocked HTTP only; production flag OFF"); a Postgres-backed
// adapter with the same shape is P2's production-flagged follow-on, out of
// scope here. The in-memory shape mirrors the brief's relations closely
// enough that porting later is a storage swap, not a redesign.
//
// Admin boundary (brief §4): "Repo contents cannot register themselves,"
// "Protected admin-write boundary; payloads cannot populate them." Every
// mutating call here takes an explicit `adminCtx` that must itself carry
// `origin: "jason-admin"` — never derived from an ordinary signed envelope,
// never satisfiable by a principal registering/granting itself.

import { verifyEnvelopeSignature, canonicalize } from "./envelope.mjs";
import { fail, CODES } from "./errors.mjs";
import { validateResource } from "./envelopeValidator.mjs";

const ADMIN_ORIGIN = "jason-admin";

function requireAdmin(adminCtx) {
  if (!adminCtx || adminCtx.origin !== ADMIN_ORIGIN) {
    fail(CODES.NOT_ADMIN_ORIGIN, "registry mutation requires an explicit Jason-origin admin context", {
      givenOrigin: adminCtx && adminCtx.origin,
    });
  }
}

export function createRegistry() {
  return {
    // keyId -> { principalId, publicKey, originChannel, registeredBy,
    //            registrationReceipt, revokedAt, revokedReason }
    keys: new Map(),
    // grantId -> { principalId, resourceRepo, resourceScope, allowedOperations,
    //              registeredBy, grantRevision, revokedAt, revokedReason }
    grants: new Map(),
    // operationId -> canonical full operation identity (first-seen), for
    // replay detection. TBP2-004: this is NOT just a payload digest.
    // Identity covers every signed attribution field, so a changed
    // actor, action, resource/scope/head/source, version, or nonce with
    // an unchanged payload is a conflicting replay, never an identical
    // one. See replayIdentity() below.
    seenOperations: new Map(),
  };
}

// Registers a principal's key. `registeredBy` must differ from
// `principalId` — a principal cannot vouch for itself (SELF_REGISTRATION_FORBIDDEN),
// even under a valid admin context, because the brief requires registration
// to be a Jason-reviewed bundle naming who registered whom, not a principal
// asserting its own trust.
export function registerKey(registry, adminCtx, params) {
  requireAdmin(adminCtx);
  const { keyId, principalId, publicKey, originChannel, registeredBy, registrationReceipt } = params;
  if (!keyId || !principalId || !publicKey || !registeredBy) {
    fail(CODES.MALFORMED_ENVELOPE, "registerKey missing required fields", { params });
  }
  if (registeredBy === principalId) {
    fail(CODES.SELF_REGISTRATION_FORBIDDEN, "a principal cannot register its own key", {
      principalId,
    });
  }
  registry.keys.set(keyId, {
    principalId,
    publicKey,
    originChannel: originChannel ?? "unspecified",
    registeredBy,
    registrationReceipt: registrationReceipt ?? null,
    revokedAt: null,
    revokedReason: null,
  });
  return { keyId, principalId };
}

export function revokeKey(registry, adminCtx, keyId, reason, now) {
  requireAdmin(adminCtx);
  const entry = registry.keys.get(keyId);
  if (!entry) fail(CODES.UNKNOWN_KEY, "cannot revoke an unregistered key", { keyId });
  entry.revokedAt = now ?? new Date().toISOString();
  entry.revokedReason = reason ?? "unspecified";
  return { keyId, revokedAt: entry.revokedAt };
}

// Resolves a key id to its registered principal + public key, honestly
// reporting UNKNOWN_KEY for anything never registered (brief §4: "a
// Markdown Submitted-by line... does not authenticate ChatGPT... set
// origin AUTH_UNVERIFIED until a separately registered provenance adapter
// authenticates" — this function is that boundary: no fallback trust).
export function resolveKey(registry, keyId) {
  const entry = registry.keys.get(keyId);
  if (!entry) fail(CODES.UNKNOWN_KEY, "key is not registered", { keyId });
  if (entry.revokedAt) {
    fail(CODES.KEY_REVOKED, "key was revoked", { keyId, revokedAt: entry.revokedAt, reason: entry.revokedReason });
  }
  return entry;
}

export function grantAuthorization(registry, adminCtx, params) {
  requireAdmin(adminCtx);
  const { grantId, principalId, resourceRepo, resourceScope, allowedOperations, registeredBy } = params;
  if (!grantId || !principalId || !resourceRepo || !Array.isArray(allowedOperations) || allowedOperations.length === 0) {
    fail(CODES.MALFORMED_ENVELOPE, "grantAuthorization missing required fields", { params });
  }
  const existing = registry.grants.get(grantId);
  registry.grants.set(grantId, {
    principalId,
    resourceRepo,
    resourceScope: resourceScope ?? "*",
    allowedOperations,
    registeredBy: registeredBy ?? adminCtx.origin,
    grantRevision: existing ? existing.grantRevision + 1 : 1,
    revokedAt: null,
    revokedReason: null,
  });
  return { grantId, grantRevision: registry.grants.get(grantId).grantRevision };
}

export function revokeAuthorization(registry, adminCtx, grantId, reason, now) {
  requireAdmin(adminCtx);
  const entry = registry.grants.get(grantId);
  if (!entry) fail(CODES.UNKNOWN_PRINCIPAL, "cannot revoke an unknown grant", { grantId });
  entry.revokedAt = now ?? new Date().toISOString();
  entry.revokedReason = reason ?? "unspecified";
  return { grantId, revokedAt: entry.revokedAt };
}

// True only if `principalId` holds a live (non-revoked) grant covering
// `operation` on `resource.repo`/`resource.scope`. Scope "*" on the grant
// matches any requested scope; an exact grant scope must match exactly —
// no prefix/wildcard matching on the REQUEST side, only on a grant that was
// explicitly registered as "*".
export function checkAuthorized(registry, principalId, operation, resource) {
  for (const grant of registry.grants.values()) {
    if (grant.revokedAt) continue;
    if (grant.principalId !== principalId) continue;
    if (grant.resourceRepo !== resource.repo) continue;
    if (grant.resourceScope !== "*" && grant.resourceScope !== resource.scope) continue;
    if (!grant.allowedOperations.includes(operation)) continue;
    return true;
  }
  return false;
}

// Canonical full operation identity: every signed attribution field of
// the envelope, in canonical JSON form, excluding only the signature
// itself (which is derived from these fields). Two envelopes are the
// same operation only when all of these match. TBP2-004: comparing only
// the payload digest let a different operation, scope, head, actor, or
// nonce ride in as an "identical" replay.
export function replayIdentity(envelope) {
  return canonicalize({
    schema_version: envelope.schema_version,
    operation_id: envelope.operation_id,
    principal_id: envelope.principal_id,
    key_id: envelope.key_id,
    issued_at: envelope.issued_at,
    operation: envelope.operation,
    resource: envelope.resource,
    expected_row_version: envelope.expected_row_version,
    nonce: envelope.nonce,
    payload_sha256: envelope.payload_sha256,
  });
}

// Throws OPERATION_REPLAYED for an exactly identical operation, or
// CONFLICTING_REPLAY for the same operation_id with any changed binding.
// Does not record anything — recording is a separate, explicit step.
export function checkSeenOperation(registry, envelope) {
  const seen = registry.seenOperations.get(envelope.operation_id);
  if (seen === undefined) return;
  if (seen === replayIdentity(envelope)) {
    fail(CODES.OPERATION_REPLAYED, "operation_id already processed with identical full operation identity", {
      operationId: envelope.operation_id,
    });
  }
  fail(CODES.CONFLICTING_REPLAY, "operation_id already processed with a DIFFERENT operation identity", {
    operationId: envelope.operation_id,
  });
}

// Records an operation as seen. Callers must call this only after the
// operation has actually been admitted and, for dispatched operations,
// successfully handled — recording before handler execution would let a
// failed or never-handled operation masquerade as completed work.
export function recordSeenOperation(registry, envelope) {
  registry.seenOperations.set(envelope.operation_id, replayIdentity(envelope));
}

// End-to-end: verify signature, verify the signing key's registered
// principal actually matches the envelope's CLAIMED principal_id
// (SIGNER_NOT_PRINCIPAL — "shared-helper signer is not the reviewer"),
// check authorization for the operation+resource, and reject replays.
//
// Replay semantics (brief §5 "exact replay returns existing result; any
// changed attribution/binding conflicts atomically" — full handoff replay
// lives in P4, but the trust boundary's own replay check is in scope here):
// same operation_id + identical full identity => OPERATION_REPLAYED
// (caller decides whether to treat that as a safe no-op resume); same
// operation_id + ANY changed attribution/binding => CONFLICTING_REPLAY,
// always rejected.
//
// Recording: by default this function records the operation after all
// checks pass (direct callers, including the existing tests, rely on
// that). Pass { record: false } when the caller will record itself only
// after successful handling — that is what handleEnvelope does, so a
// handler failure or a missing handler never marks the operation seen.
export function verifyAndAuthorize(registry, envelope, expected, opts = {}) {
  // TBP2-003: an external pin is itself validated before anything else.
  // A malformed or unknown pin field is refused, never silently ignored,
  // so a caller cannot accidentally believe it pinned something it did
  // not. A supplied resource pin must name a repo (validateResource,
  // forPin: true, enforces that).
  if (expected !== undefined && expected !== null) {
    if (typeof expected !== "object" || Array.isArray(expected)) {
      fail(CODES.MALFORMED_ENVELOPE, "expected pin must be an object", { reason: "EXPECTED_NOT_AN_OBJECT" });
    }
    if (expected.operation !== undefined) {
      if (typeof expected.operation !== "string" || expected.operation.length === 0) {
        fail(CODES.MALFORMED_ENVELOPE, "expected operation must be a nonempty string", { field: "operation" });
      }
    }
    if (expected.resource !== undefined) {
      validateResource(expected.resource, { forPin: true });
    }
  }
  const { operation: expectedOperation, resource: expectedResource } = expected ?? {};

  const keyEntry = resolveKey(registry, envelope.key_id); // throws UNKNOWN_KEY / KEY_REVOKED
  verifyEnvelopeSignature(envelope, keyEntry.publicKey); // throws SIGNATURE_INVALID / PAYLOAD_HASH_MISMATCH / MALFORMED_ENVELOPE

  if (keyEntry.principalId !== envelope.principal_id) {
    fail(CODES.SIGNER_NOT_PRINCIPAL, "the key's registered principal does not match the envelope's claimed principal", {
      claimedPrincipal: envelope.principal_id,
      actualPrincipal: keyEntry.principalId,
    });
  }

  if (expectedOperation && envelope.operation !== expectedOperation) {
    fail(CODES.NOT_AUTHORIZED_FOR_OPERATION, "envelope operation does not match the expected operation", {
      expected: expectedOperation,
      actual: envelope.operation,
    });
  }
  if (expectedResource) {
    if (envelope.resource?.repo !== expectedResource.repo) {
      fail(CODES.RESOURCE_BINDING_MISMATCH, "envelope resource.repo does not match the expected resource", {
        expected: expectedResource.repo,
        actual: envelope.resource?.repo,
      });
    }
    if (expectedResource.reviewed_head && envelope.resource?.reviewed_head !== expectedResource.reviewed_head) {
      fail(CODES.HEAD_BINDING_MISMATCH, "envelope resource.reviewed_head does not match the expected head", {
        expected: expectedResource.reviewed_head,
        actual: envelope.resource?.reviewed_head,
      });
    }
    // TBP2-003: every load-bearing pin binding is compared, not just
    // repo and head. A pin scope of "*" is an explicit any-scope pin
    // (same convention as grants) and matches any envelope scope; any
    // other pin scope, source, or subject must match exactly.
    for (const field of ["scope", "source", "subject"]) {
      if (expectedResource[field] === undefined) continue;
      if (field === "scope" && expectedResource[field] === "*") continue;
      if (envelope.resource?.[field] !== expectedResource[field]) {
        fail(CODES.RESOURCE_BINDING_MISMATCH, `envelope resource.${field} does not match the expected resource`, {
          binding: field,
          expected: expectedResource[field],
          actual: envelope.resource?.[field],
        });
      }
    }
  }

  if (!checkAuthorized(registry, envelope.principal_id, envelope.operation, envelope.resource)) {
    fail(CODES.NOT_AUTHORIZED_FOR_OPERATION, "principal has no live grant for this operation/resource", {
      principalId: envelope.principal_id,
      operation: envelope.operation,
      resource: envelope.resource,
    });
  }

  checkSeenOperation(registry, envelope);
  if (opts.record !== false) {
    recordSeenOperation(registry, envelope);
  }

  return { principalId: envelope.principal_id, operation: envelope.operation };
}
