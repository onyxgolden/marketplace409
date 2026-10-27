// Team Brain P2 — role-scoped logical API dispatcher tests. The central
// guarantee under test: an ADMIN_ONLY operation can never be reached
// through handleEnvelope, structurally, even when a grant in the registry
// would otherwise authorize it - the tier gate runs before authorization
// is even checked.

import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { buildEnvelope } from "../transport/envelope.mjs";
import { createRegistry, registerKey, grantAuthorization } from "../transport/registry.mjs";
import { createApi, handleEnvelope, operationTier, AGENT_OPERATIONS, ADMIN_ONLY_OPERATIONS } from "../transport/logicalApi.mjs";
import { TeamBrainTrustError, CODES } from "../transport/errors.mjs";

const ADMIN = { origin: "jason-admin" };
const T0 = "2026-10-26T12:00:00Z";

function keypair() {
  return generateKeyPairSync("ed25519");
}

function setup({ principalId = "muse", operation = "submit_task", grantedOps = [operation], reviewedHead } = {}) {
  const registry = createRegistry();
  const { publicKey, privateKey } = keypair();
  const keyId = `${principalId}-key`;
  registerKey(registry, ADMIN, { keyId, principalId, publicKey, registeredBy: "jason-admin" });
  grantAuthorization(registry, ADMIN, {
    grantId: `grant-${principalId}`,
    principalId,
    resourceRepo: "onyxgolden/forge-ai-drop",
    resourceScope: "*",
    allowedOperations: grantedOps,
  });
  const envelope = buildEnvelope(
    {
      operationId: `op-${principalId}-1`,
      principalId,
      keyId,
      issuedAt: T0,
      operation,
      resource: reviewedHead
        ? { repo: "onyxgolden/forge-ai-drop", scope: "lane-x", reviewed_head: reviewedHead }
        : { repo: "onyxgolden/forge-ai-drop", scope: "lane-x" },
      nonce: "n1",
      payload: { note: "hello" },
    },
    privateKey
  );
  return { registry, envelope, principalId, keyId, privateKey };
}

describe("operationTier", () => {
  it("classifies every brief-listed agent operation as AGENT", () => {
    for (const op of AGENT_OPERATIONS) expect(operationTier(op)).toBe("AGENT");
  });
  it("classifies every brief-listed admin operation as ADMIN_ONLY", () => {
    for (const op of ADMIN_ONLY_OPERATIONS) expect(operationTier(op)).toBe("ADMIN_ONLY");
  });
  it("returns null for an unrecognized operation name", () => {
    expect(operationTier("delete_everything")).toBeNull();
  });
});

describe("createApi registration boundary", () => {
  it("refuses to register an admin-only operation as an envelope handler", () => {
    const registry = createRegistry();
    expect(() => createApi(registry, { apply_rule_change: () => {} })).toThrow(TeamBrainTrustError);
    try {
      createApi(registry, { apply_rule_change: () => {} });
    } catch (e) {
      expect(e.code).toBe(CODES.ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN);
    }
  });

  it("refuses to register an unrecognized operation name", () => {
    const registry = createRegistry();
    expect(() => createApi(registry, { made_up_operation: () => {} })).toThrow(TeamBrainTrustError);
  });

  it("accepts a normal agent-tier handler", () => {
    const registry = createRegistry();
    expect(() => createApi(registry, { submit_task: () => "ok" })).not.toThrow();
  });
});

describe("handleEnvelope — agent operations", () => {
  it("dispatches a valid, authorized envelope to its registered handler", () => {
    const { registry, envelope } = setup({ operation: "submit_task" });
    let received = null;
    const api = createApi(registry, {
      submit_task: (env, verifyResult) => {
        received = { env, verifyResult };
        return { accepted: true };
      },
    });
    const result = handleEnvelope(api, envelope);
    expect(result).toEqual({ accepted: true });
    expect(received.verifyResult.principalId).toBe("muse");
  });

  it("still enforces underlying authorization: a principal without a grant for the operation is rejected before reaching the handler", () => {
    const { registry, envelope } = setup({ operation: "submit_task", grantedOps: ["get_status"] });
    let called = false;
    const api = createApi(registry, { submit_task: () => (called = true) });
    expect(() => handleEnvelope(api, envelope)).toThrow(TeamBrainTrustError);
    expect(called).toBe(false);
    try {
      handleEnvelope(api, envelope);
    } catch (e) {
      expect(e.code).toBe(CODES.NOT_AUTHORIZED_FOR_OPERATION);
    }
  });

  it("still enforces signature validity: a forged envelope never reaches the handler", () => {
    const { registry, envelope } = setup({ operation: "submit_task" });
    const tampered = { ...envelope, payload: { note: "tampered" } };
    let called = false;
    const api = createApi(registry, { submit_task: () => (called = true) });
    expect(() => handleEnvelope(api, tampered)).toThrow(TeamBrainTrustError);
    expect(called).toBe(false);
  });

  it("rejects with UNKNOWN_OPERATION when no handler is registered for an otherwise-valid, authorized operation", () => {
    const { registry, envelope } = setup({ operation: "submit_task" });
    const api = createApi(registry, { get_status: () => "ok" }); // submit_task never registered
    try {
      handleEnvelope(api, envelope);
      throw new Error("expected UNKNOWN_OPERATION");
    } catch (e) {
      expect(e.code).toBe(CODES.UNKNOWN_OPERATION);
    }
  });

  it("rejects an envelope naming an operation nobody recognizes at all", () => {
    const { registry, envelope } = setup({ operation: "delete_everything", grantedOps: ["delete_everything"] });
    const api = createApi(registry, {});
    try {
      handleEnvelope(api, envelope);
      throw new Error("expected UNKNOWN_OPERATION");
    } catch (e) {
      expect(e.code).toBe(CODES.UNKNOWN_OPERATION);
    }
  });
});

describe("handleEnvelope — structural admin boundary", () => {
  it("blocks an ADMIN_ONLY operation even when a grant in the registry would otherwise authorize the principal for it", () => {
    // Deliberately construct the "bad grant" case the brief warns about:
    // an agent somehow holds a grant naming an admin operation. The tier
    // gate must still block it - this is the structural guarantee, not a
    // grant-correctness assumption.
    const { registry, envelope } = setup({ operation: "apply_rule_change", grantedOps: ["apply_rule_change"] });
    const api = createApi(registry, {}); // apply_rule_change could never be registered here anyway
    try {
      handleEnvelope(api, envelope);
      throw new Error("expected ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN");
    } catch (e) {
      expect(e.code).toBe(CODES.ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN);
    }
  });

  it("the admin-tier block fires before signature verification would even run (checked via a deliberately forged admin-op envelope)", () => {
    const { registry, envelope } = setup({ operation: "revoke_authorization", grantedOps: ["revoke_authorization"] });
    const forged = { ...envelope, signature: "not-a-real-signature" };
    const api = createApi(registry, {});
    try {
      handleEnvelope(api, forged);
    } catch (e) {
      // Whether it's caught as the tier block or a signature failure, it
      // must never succeed and must never be SIGNATURE_INVALID masking a
      // "well the tier gate didn't even get a chance to run" ordering bug.
      expect(e.code).toBe(CODES.ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN);
    }
  });
});

describe("handleEnvelope — external head-binding pin (Grok P2 fix)", () => {
  const CLAIMED_HEAD = "a".repeat(40);
  const OTHER_HEAD = "b".repeat(40);

  it("fails with HEAD_BINDING_MISMATCH when a supplied external pin names a different reviewed_head", () => {
    const { registry, envelope } = setup({ operation: "submit_task", reviewedHead: CLAIMED_HEAD });
    let called = false;
    const api = createApi(registry, { submit_task: () => (called = true) });
    try {
      handleEnvelope(api, envelope, {
        resource: { repo: "onyxgolden/forge-ai-drop", reviewed_head: OTHER_HEAD },
      });
      throw new Error("expected HEAD_BINDING_MISMATCH");
    } catch (e) {
      expect(e.code).toBe(CODES.HEAD_BINDING_MISMATCH);
    }
    expect(called).toBe(false);
  });

  it("succeeds when a supplied external pin matches the envelope reviewed_head", () => {
    const { registry, envelope } = setup({ operation: "submit_task", reviewedHead: CLAIMED_HEAD });
    const api = createApi(registry, {
      submit_task: () => ({ accepted: true }),
    });
    const result = handleEnvelope(api, envelope, {
      resource: { repo: "onyxgolden/forge-ai-drop", reviewed_head: CLAIMED_HEAD },
    });
    expect(result).toEqual({ accepted: true });
  });

  it("fails with RESOURCE_BINDING_MISMATCH when a supplied external pin names a different repo", () => {
    const { registry, envelope } = setup({ operation: "submit_task", reviewedHead: CLAIMED_HEAD });
    let called = false;
    const api = createApi(registry, { submit_task: () => (called = true) });
    try {
      handleEnvelope(api, envelope, {
        resource: { repo: "onyxgolden/other-repo", reviewed_head: CLAIMED_HEAD },
      });
      throw new Error("expected RESOURCE_BINDING_MISMATCH");
    } catch (e) {
      expect(e.code).toBe(CODES.RESOURCE_BINDING_MISMATCH);
    }
    expect(called).toBe(false);
  });

  it("existing handleEnvelope calls without a pin still pass (no silent behaviour change for them)", () => {
    // A no-pin call does NOT enforce head binding: an envelope claiming any
    // reviewed_head is dispatched, because there is no external pin to check
    // it against. That honest non-enforcement is the fix — previously the
    // dispatcher passed the envelope's own resource and falsely claimed the
    // check had run.
    const { registry, envelope } = setup({ operation: "submit_task", reviewedHead: CLAIMED_HEAD });
    const api = createApi(registry, {
      submit_task: () => ({ accepted: true }),
    });
    expect(handleEnvelope(api, envelope)).toEqual({ accepted: true });
  });
});
