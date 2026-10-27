// Team Brain P2 — trust/transport boundary tests: signed envelopes +
// key/authority registry. No network, no DB (P2 scope: synthetic/local
// only). Covers the brief's required P2 test categories that apply to this
// module: forged self-registration, shared-helper signer is not the
// reviewer, wrong resource/head, revocation, unregistered principal
// honestly unknown, replay, zero credential leakage.

import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { buildEnvelope, verifyEnvelopeSignature, canonicalize, sha256Hex } from "../transport/envelope.mjs";
import {
  createRegistry,
  registerKey,
  revokeKey,
  resolveKey,
  grantAuthorization,
  revokeAuthorization,
  checkAuthorized,
  verifyAndAuthorize,
} from "../transport/registry.mjs";
import { TeamBrainTrustError, CODES } from "../transport/errors.mjs";

const ADMIN = { origin: "jason-admin" };
const T0 = "2026-10-26T12:00:00Z";

function keypair() {
  return generateKeyPairSync("ed25519");
}

function envelopeFor({ principalId, keyId, privateKey, operation, resource, payload, operationId, nonce }) {
  return buildEnvelope(
    {
      operationId: operationId ?? `op-${principalId}-1`,
      principalId,
      keyId,
      issuedAt: T0,
      operation: operation ?? "submit_verdict",
      // TBP2-002A fixture update (explicit, not a silent preserve):
      // the old default head "abc123" was not a canonical head
      // identity. Verdict envelopes also carry their result source.
      resource: resource ?? {
        repo: "onyxgolden/marketplace409",
        scope: "pr-639",
        source: "synthetic-reviewer",
        reviewed_head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      nonce: nonce ?? "nonce-1",
      payload: payload ?? { verdict: "GO" },
    },
    privateKey
  );
}

function setup({ principalId = "chatgpt-reviewer", registeredBy = "muse" } = {}) {
  const registry = createRegistry();
  const { publicKey, privateKey } = keypair();
  const keyId = `${principalId}-key-1`;
  registerKey(registry, ADMIN, {
    keyId,
    principalId,
    publicKey,
    originChannel: "test",
    registeredBy,
    registrationReceipt: "receipt-1",
  });
  grantAuthorization(registry, ADMIN, {
    grantId: `grant-${principalId}-1`,
    principalId,
    resourceRepo: "onyxgolden/marketplace409",
    resourceScope: "pr-639",
    allowedOperations: ["submit_verdict"],
    registeredBy: "jason-admin",
  });
  return { registry, publicKey, privateKey, keyId, principalId };
}

describe("canonicalize", () => {
  it("produces identical bytes regardless of key insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it("preserves array order (order is meaningful there)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined fields so they can never affect the signed bytes", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("envelope roundtrip", () => {
  it("builds and verifies a valid envelope", () => {
    const { registry, privateKey, publicKey, keyId, principalId } = setup();
    const env = envelopeFor({ principalId, keyId, privateKey });
    expect(() => verifyEnvelopeSignature(env, publicKey)).not.toThrow();
    const result = verifyAndAuthorize(registry, env, {
      operation: "submit_verdict",
      resource: { repo: "onyxgolden/marketplace409" },
    });
    expect(result.principalId).toBe(principalId);
  });

  it("rejects a tampered payload (payload_sha256 mismatch)", () => {
    const { privateKey, publicKey, keyId, principalId } = setup();
    const env = envelopeFor({ principalId, keyId, privateKey });
    const tampered = { ...env, payload: { verdict: "NEEDS_CHANGES" } };
    expect(() => verifyEnvelopeSignature(tampered, publicKey)).toThrow(TeamBrainTrustError);
    try {
      verifyEnvelopeSignature(tampered, publicKey);
    } catch (e) {
      expect(e.code).toBe(CODES.PAYLOAD_HASH_MISMATCH);
    }
  });

  it("rejects a forged signature (wrong key)", () => {
    const { privateKey, keyId, principalId } = setup();
    const env = envelopeFor({ principalId, keyId, privateKey });
    const { publicKey: wrongPublicKey } = keypair();
    expect(() => verifyEnvelopeSignature(env, wrongPublicKey)).toThrow(TeamBrainTrustError);
    try {
      verifyEnvelopeSignature(env, wrongPublicKey);
    } catch (e) {
      expect(e.code).toBe(CODES.SIGNATURE_INVALID);
    }
  });

  it("rejects a flipped-bit signature as forged, not as a different valid signature", () => {
    const { privateKey, publicKey, keyId, principalId } = setup();
    const env = envelopeFor({ principalId, keyId, privateKey });
    const sigBytes = Buffer.from(env.signature, "base64");
    sigBytes[0] ^= 0xff;
    const forged = { ...env, signature: sigBytes.toString("base64") };
    expect(() => verifyEnvelopeSignature(forged, publicKey)).toThrow(TeamBrainTrustError);
  });

  it("rejects a malformed envelope missing a signature", () => {
    const { publicKey } = setup();
    expect(() => verifyEnvelopeSignature({ payload: {} }, publicKey)).toThrow(TeamBrainTrustError);
  });

  it("buildEnvelope refuses to build with a missing required field", () => {
    const { privateKey } = keypair();
    expect(() =>
      buildEnvelope(
        { principalId: "x", keyId: "k", issuedAt: T0, operation: "op", resource: {}, nonce: "n" },
        privateKey
      )
    ).toThrow(TeamBrainTrustError);
  });
});

describe("registry admin boundary", () => {
  it("forbids a principal from registering its own key (forged self-registration)", () => {
    const registry = createRegistry();
    const { publicKey } = keypair();
    expect(() =>
      registerKey(registry, ADMIN, {
        keyId: "self-key",
        principalId: "koe-sr",
        publicKey,
        registeredBy: "koe-sr",
      })
    ).toThrow(TeamBrainTrustError);
    try {
      registerKey(registry, ADMIN, {
        keyId: "self-key-2",
        principalId: "koe-sr",
        publicKey,
        registeredBy: "koe-sr",
      });
    } catch (e) {
      expect(e.code).toBe(CODES.SELF_REGISTRATION_FORBIDDEN);
    }
  });

  it("refuses any registry mutation without a Jason-origin admin context", () => {
    const registry = createRegistry();
    const { publicKey } = keypair();
    expect(() =>
      registerKey(registry, { origin: "koe-sr" }, {
        keyId: "k",
        principalId: "p",
        publicKey,
        registeredBy: "muse",
      })
    ).toThrow(TeamBrainTrustError);
    expect(() => registerKey(registry, null, { keyId: "k", principalId: "p", publicKey, registeredBy: "muse" })).toThrow(
      TeamBrainTrustError
    );
  });

  it("payloads cannot populate the registry: verifyAndAuthorize never mutates keys/grants", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    const env = envelopeFor({ principalId, keyId, privateKey });
    const keysBefore = registry.keys.size;
    const grantsBefore = registry.grants.size;
    verifyAndAuthorize(registry, env, {});
    expect(registry.keys.size).toBe(keysBefore);
    expect(registry.grants.size).toBe(grantsBefore);
  });
});

describe("signer identity", () => {
  it("rejects when the signing key's registered principal is not the envelope's claimed principal (shared-helper signer is not the reviewer)", () => {
    const { registry, privateKey, keyId } = setup({ principalId: "koe-sr-shared-helper" });
    // koe-sr-shared-helper's key signs, but the envelope CLAIMS to be
    // chatgpt-reviewer — the registry must catch this even though the
    // signature itself verifies fine against the key that actually signed.
    const env = envelopeFor({ principalId: "chatgpt-reviewer", keyId, privateKey });
    expect(() => verifyAndAuthorize(registry, env, {})).toThrow(TeamBrainTrustError);
    try {
      verifyAndAuthorize(registry, env, {});
    } catch (e) {
      expect(e.code).toBe(CODES.SIGNER_NOT_PRINCIPAL);
    }
  });
});

describe("unregistered principal", () => {
  it("reports an unregistered key (e.g. an unregistered ChatGPT channel) as honestly UNKNOWN_KEY, never silently trusted", () => {
    const registry = createRegistry();
    expect(() => resolveKey(registry, "chatgpt-unregistered-key")).toThrow(TeamBrainTrustError);
    try {
      resolveKey(registry, "chatgpt-unregistered-key");
    } catch (e) {
      expect(e.code).toBe(CODES.UNKNOWN_KEY);
    }
  });

  it("verifyAndAuthorize fails UNKNOWN_KEY for an envelope signed by a never-registered key, not any other code", () => {
    const registry = createRegistry();
    const { privateKey } = keypair();
    const env = envelopeFor({ principalId: "chatgpt-reviewer", keyId: "never-registered", privateKey });
    try {
      verifyAndAuthorize(registry, env, {});
      throw new Error("expected UNKNOWN_KEY");
    } catch (e) {
      expect(e.code).toBe(CODES.UNKNOWN_KEY);
    }
  });
});

describe("resource/head binding", () => {
  it("rejects an envelope bound to the wrong resource repo", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    const env = envelopeFor({
      principalId,
      keyId,
      privateKey,
      // TBP2-002A: this submit_verdict envelope must itself be valid
      // (scope/source/head) so the test actually exercises the repo
      // binding mismatch, not a malformed-envelope refusal.
      resource: {
        repo: "onyxgolden/other-repo",
        scope: "pr-639",
        source: "synthetic-reviewer",
        reviewed_head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    try {
      verifyAndAuthorize(registry, env, { resource: { repo: "onyxgolden/marketplace409" } });
      throw new Error("expected RESOURCE_BINDING_MISMATCH");
    } catch (e) {
      expect(e.code).toBe(CODES.RESOURCE_BINDING_MISMATCH);
    }
  });

  it("rejects an envelope bound to the wrong reviewed_head", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    const env = envelopeFor({
      principalId,
      keyId,
      privateKey,
      // TBP2-002A fixture update (explicit): old "stale-head" /
      // "current-head" were not canonical head identities, and this
      // submit_verdict envelope now also carries its result source.
      resource: {
        repo: "onyxgolden/marketplace409",
        scope: "pr-639",
        source: "synthetic-reviewer",
        reviewed_head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });
    try {
      verifyAndAuthorize(registry, env, {
        resource: { repo: "onyxgolden/marketplace409", reviewed_head: "cccccccccccccccccccccccccccccccccccccccc" },
      });
      throw new Error("expected HEAD_BINDING_MISMATCH");
    } catch (e) {
      expect(e.code).toBe(CODES.HEAD_BINDING_MISMATCH);
    }
  });
});

describe("authorization", () => {
  it("rejects an operation the principal was never granted", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    const env = envelopeFor({ principalId, keyId, privateKey, operation: "apply_rule_change" });
    try {
      verifyAndAuthorize(registry, env, {});
      throw new Error("expected NOT_AUTHORIZED_FOR_OPERATION");
    } catch (e) {
      expect(e.code).toBe(CODES.NOT_AUTHORIZED_FOR_OPERATION);
    }
  });

  it("a grant scoped to one resourceScope does not authorize a different scope", () => {
    const { registry, principalId } = setup();
    expect(
      checkAuthorized(registry, principalId, "submit_verdict", {
        repo: "onyxgolden/marketplace409",
        scope: "pr-999",
      })
    ).toBe(false);
  });

  it("a grant scoped '*' authorizes any resourceScope on that repo", () => {
    const registry = createRegistry();
    grantAuthorization(registry, ADMIN, {
      grantId: "g-wild",
      principalId: "muse",
      resourceRepo: "onyxgolden/marketplace409",
      resourceScope: "*",
      allowedOperations: ["submit_verdict"],
    });
    expect(
      checkAuthorized(registry, "muse", "submit_verdict", { repo: "onyxgolden/marketplace409", scope: "pr-anything" })
    ).toBe(true);
  });
});

describe("revocation", () => {
  it("a revoked key is rejected on resolve, even though it was validly registered", () => {
    const { registry, keyId } = setup();
    revokeKey(registry, ADMIN, keyId, "compromised", T0);
    try {
      resolveKey(registry, keyId);
      throw new Error("expected KEY_REVOKED");
    } catch (e) {
      expect(e.code).toBe(CODES.KEY_REVOKED);
    }
  });

  it("a revoked key cannot create new authenticated events even with a perfectly valid signature", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    revokeKey(registry, ADMIN, keyId, "compromised", T0);
    const env = envelopeFor({ principalId, keyId, privateKey });
    try {
      verifyAndAuthorize(registry, env, {});
      throw new Error("expected KEY_REVOKED");
    } catch (e) {
      expect(e.code).toBe(CODES.KEY_REVOKED);
    }
  });

  it("revoking an unknown key fails loudly instead of silently no-op-ing", () => {
    const registry = createRegistry();
    expect(() => revokeKey(registry, ADMIN, "nope", "x")).toThrow(TeamBrainTrustError);
  });

  it("a revoked authorization is no longer granted, but stays in history for diagnosis", () => {
    const { registry, principalId } = setup();
    const grantId = `grant-${principalId}-1`;
    expect(checkAuthorized(registry, principalId, "submit_verdict", { repo: "onyxgolden/marketplace409", scope: "pr-639" })).toBe(
      true
    );
    revokeAuthorization(registry, ADMIN, grantId, "superseded", T0);
    expect(checkAuthorized(registry, principalId, "submit_verdict", { repo: "onyxgolden/marketplace409", scope: "pr-639" })).toBe(
      false
    );
    expect(registry.grants.get(grantId).revokedAt).toBe(T0);
  });
});

describe("replay", () => {
  it("accepts the first use of an operation_id, then rejects an identical replay", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    const env = envelopeFor({ principalId, keyId, privateKey, operationId: "op-fixed-1" });
    expect(() => verifyAndAuthorize(registry, env, {})).not.toThrow();
    try {
      verifyAndAuthorize(registry, env, {});
      throw new Error("expected OPERATION_REPLAYED");
    } catch (e) {
      expect(e.code).toBe(CODES.OPERATION_REPLAYED);
    }
  });

  it("rejects a SAME operation_id with a DIFFERENT payload as a conflicting replay, distinct from an identical replay", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    const first = envelopeFor({ principalId, keyId, privateKey, operationId: "op-fixed-2", payload: { verdict: "GO" } });
    verifyAndAuthorize(registry, first, {});
    const second = envelopeFor({
      principalId,
      keyId,
      privateKey,
      operationId: "op-fixed-2",
      payload: { verdict: "NEEDS_CHANGES" },
    });
    try {
      verifyAndAuthorize(registry, second, {});
      throw new Error("expected CONFLICTING_REPLAY");
    } catch (e) {
      expect(e.code).toBe(CODES.CONFLICTING_REPLAY);
    }
  });

  it("different operation_ids with the same payload are independent, not treated as replays of each other", () => {
    const { registry, privateKey, keyId, principalId } = setup();
    const a = envelopeFor({ principalId, keyId, privateKey, operationId: "op-a", payload: { verdict: "GO" } });
    const b = envelopeFor({ principalId, keyId, privateKey, operationId: "op-b", payload: { verdict: "GO" } });
    expect(() => verifyAndAuthorize(registry, a, {})).not.toThrow();
    expect(() => verifyAndAuthorize(registry, b, {})).not.toThrow();
  });
});

describe("zero credential leakage", () => {
  it("the registry never stores a private key anywhere in its state", () => {
    const { registry, privateKey } = setup();
    const serialized = JSON.stringify(
      [...registry.keys.values()].map((k) => ({ ...k, publicKey: "[KeyObject]" }))
    );
    // A real private key export would contain PEM/DER bytes; make sure
    // nothing resembling that, nor the actual KeyObject, ended up stored.
    expect(serialized).not.toContain("PRIVATE KEY");
    for (const entry of registry.keys.values()) {
      expect(entry.privateKey).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(entry, "privateKey")).toBe(false);
    }
    void privateKey; // the only copy stays in the test's own local scope
  });

  it("a thrown trust error never embeds the raw signature or payload bytes in its message", () => {
    const { registry, privateKey, keyId } = setup({ principalId: "chatgpt-reviewer" });
    const env = envelopeFor({ principalId: "someone-else", keyId, privateKey });
    try {
      verifyAndAuthorize(registry, env, {});
      throw new Error("expected SIGNER_NOT_PRINCIPAL");
    } catch (e) {
      expect(e.message).not.toContain(env.signature);
    }
  });
});

describe("sha256Hex", () => {
  it("is deterministic for the same canonical input", () => {
    const json = canonicalize({ a: 1, b: 2 });
    expect(sha256Hex(json)).toBe(sha256Hex(json));
  });

  it("changes when the payload changes", () => {
    expect(sha256Hex(canonicalize({ a: 1 }))).not.toBe(sha256Hex(canonicalize({ a: 2 })));
  });
});
