import { describe, expect, it, vi } from "vitest";

import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_KEY_VERSION,
  consumeRecoveryCode,
  deriveCodeDigest,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  storeRecoveryGeneration,
  verifyRecoveryCodeDigest,
} from "./recoveryCodes.js";

const ENV = { RECOVERY_DIGEST_KEY: "test-recovery-digest-key" };
const CODE_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}){7}$/;

function decodeEntropyBits(code) {
  // Each char encodes 5 bits (32-char alphabet), 32 chars per code.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const stripped = code.replace(/-/g, "");
  let bits = 0;
  for (const ch of stripped) {
    bits += 5;
    if (!alphabet.includes(ch)) throw new Error(`unexpected char ${ch}`);
  }
  return bits;
}

describe("generateRecoveryCodes", () => {
  it("generates 10 human-transcribable codes", () => {
    const { codes, keyVersion } = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(keyVersion).toBe(RECOVERY_CODE_KEY_VERSION);
    for (const code of codes) expect(code).toMatch(CODE_RE);
  });

  it("each code carries >= 128 bits of entropy", () => {
    const { codes } = generateRecoveryCodes();
    for (const code of codes) expect(decodeEntropyBits(code)).toBeGreaterThanOrEqual(128);
  });

  it("codes are unique across generations", () => {
    const a = generateRecoveryCodes().codes;
    const b = generateRecoveryCodes().codes;
    const seen = new Set([...a, ...b]);
    expect(seen.size).toBe(a.length + b.length);
  });

  it("rejects non-positive counts", () => {
    expect(() => generateRecoveryCodes(0)).toThrow();
    expect(() => generateRecoveryCodes(-3)).toThrow();
  });
});

describe("normalizeRecoveryCode", () => {
  it("forgives case, dashes, whitespace, and O/I/L transcription mistakes", () => {
    const { codes } = generateRecoveryCodes();
    const displayed = codes[0];
    const typed = displayed.toLowerCase().replace(/-/g, " ");
    expect(verifyRecoveryCodeDigest(typed, deriveCodeDigest(displayed, 1, ENV), 1, ENV)).toBe(true);

    // O->0, I->1, L->1 mapping: construct a mistyped variant.
    const withLookalikes = displayed.replace(/0/g, "O").replace(/1/g, "I");
    expect(normalizeRecoveryCode(withLookalikes)).toBe(normalizeRecoveryCode(displayed));
    expect(verifyRecoveryCodeDigest(withLookalikes, deriveCodeDigest(displayed, 1, ENV), 1, ENV)).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(() => normalizeRecoveryCode(null)).toThrow();
  });
});

describe("deriveCodeDigest / verifyRecoveryCodeDigest", () => {
  it("is deterministic and keyed by version", () => {
    const { codes } = generateRecoveryCodes();
    const d1 = deriveCodeDigest(codes[0], 1, ENV);
    expect(deriveCodeDigest(codes[0], 1, ENV)).toBe(d1);
    expect(deriveCodeDigest(codes[0], 2, ENV)).not.toBe(d1);
    expect(deriveCodeDigest(codes[0], 1, { RECOVERY_DIGEST_KEY: "other" })).not.toBe(d1);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies a matching code and rejects a wrong one", () => {
    const { codes } = generateRecoveryCodes();
    const digest = deriveCodeDigest(codes[0], 1, ENV);
    expect(verifyRecoveryCodeDigest(codes[0], digest, 1, ENV)).toBe(true);
    expect(verifyRecoveryCodeDigest(codes[1], digest, 1, ENV)).toBe(false);
    expect(verifyRecoveryCodeDigest(codes[0], digest, 2, ENV)).toBe(false);
  });

  it("rejects malformed inputs without throwing", () => {
    expect(verifyRecoveryCodeDigest("code", "not-hex", 1, ENV)).toBe(false);
    expect(verifyRecoveryCodeDigest("code", null, 1, ENV)).toBe(false);
    expect(verifyRecoveryCodeDigest(null, "aa", 1, ENV)).toBe(false);
  });

  it("requires the server-side digest key", () => {
    const { codes } = generateRecoveryCodes();
    expect(() => deriveCodeDigest(codes[0], 1, {})).toThrow(/RECOVERY_DIGEST_KEY/);
    expect(verifyRecoveryCodeDigest(codes[0], "aa", 1, {})).toBe(false);
  });
});

describe("storeRecoveryGeneration", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function mockAdmin({ rpcResult } = {}) {
    const calls = [];
    return {
      calls,
      rpc: vi.fn(async (fn, params) => {
        calls.push({ fn, params });
        if (fn === "mfa_replace_recovery_generation") {
          return rpcResult ?? { data: params.p_generation_id, error: null };
        }
        throw new Error(`unexpected rpc ${fn}`);
      }),
    };
  }

  it("L2-004: replaces the generation in ONE atomic RPC (no multi-step client writes)", async () => {
    const admin = mockAdmin();
    const { codes } = generateRecoveryCodes();
    const { generationId } = await storeRecoveryGeneration(admin, "user-1", codes, { env: ENV });
    expect(generationId).toMatch(UUID_RE);
    // Exactly ONE database call: the atomic replacement RPC. There is no
    // separate invalidate/insert/insert sequence that can partially fail.
    expect(admin.calls).toHaveLength(1);
    const call = admin.calls[0];
    expect(call.fn).toBe("mfa_replace_recovery_generation");
    expect(call.params.p_user_id).toBe("user-1");
    expect(call.params.p_generation_id).toBe(generationId);
    expect(call.params.p_key_version).toBe(1);
    // Only digests cross the boundary — never plaintext codes.
    expect(call.params.p_code_digests).toHaveLength(RECOVERY_CODE_COUNT);
    for (const digest of call.params.p_code_digests) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const code of codes) {
      expect(call.params.p_code_digests).not.toContain(code);
    }
  });

  it("L2-004: a failed replacement throws so the caller never reports new codes", async () => {
    const admin = mockAdmin({ rpcResult: { data: null, error: new Error("boom") } });
    const { codes } = generateRecoveryCodes();
    await expect(storeRecoveryGeneration(admin, "user-1", codes, { env: ENV })).rejects.toThrow();
  });

  it("L2-004: rejects an unexpected generation id from the RPC", async () => {
    const admin = mockAdmin({ rpcResult: { data: "some-other-id", error: null } });
    const { codes } = generateRecoveryCodes();
    await expect(storeRecoveryGeneration(admin, "user-1", codes, { env: ENV })).rejects.toThrow(
      /unexpected generation id/
    );
  });
  it("requires supabaseAdmin, userId, and codes", async () => {
    const admin = mockAdmin();
    const { codes } = generateRecoveryCodes();
    await expect(storeRecoveryGeneration(null, "user-1", codes, { env: ENV })).rejects.toThrow();
    await expect(storeRecoveryGeneration(admin, "", codes, { env: ENV })).rejects.toThrow();
    await expect(storeRecoveryGeneration(admin, "user-1", [], { env: ENV })).rejects.toThrow();
  });
});

describe("consumeRecoveryCode", () => {
  // Real generated codes (synthetic fixtures): valid 32-char Crockford codes.
  const { codes: fixtureCodes } = generateRecoveryCodes();
  const presentedCode = fixtureCodes[0];
  const otherCode = fixtureCodes[1];
  const AUDIT = "audit-1";
  it("delegates atomic consumption to the RPC and returns its verdict", async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({ data: [{ consumed: true, generation_id: "gen-1" }], error: null })
    );
    const result = await consumeRecoveryCode({ rpc }, "user-1", presentedCode, "op-1", { env: ENV, auditId: AUDIT });
    expect(result).toEqual({ consumed: true, generationId: "gen-1" });
    const args = rpc.mock.calls[0][1];
    expect(rpc.mock.calls[0][0]).toBe("mfa_consume_recovery_code");
    expect(args.p_user_id).toBe("user-1");
    expect(args.p_operation_id).toBe("op-1");
    expect(args.p_audit_id).toBe(AUDIT);
    expect(args.p_code_digest).toBe(deriveCodeDigest(presentedCode, RECOVERY_CODE_KEY_VERSION, ENV));
  });

  it("a losing concurrent attempt returns consumed: false (one winner only)", async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({ data: [{ consumed: false, generation_id: "gen-1" }], error: null })
    );
    const result = await consumeRecoveryCode({ rpc }, "user-1", presentedCode, "op-2", { env: ENV, auditId: AUDIT });
    expect(result).toEqual({ consumed: false, generationId: "gen-1" });
  });

  it("an unknown code returns consumed: false without throwing", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: [{ consumed: false, generation_id: null }], error: null }));
    const result = await consumeRecoveryCode({ rpc }, "user-1", otherCode, "op-3", { env: ENV, auditId: AUDIT });
    expect(result.consumed).toBe(false);
    expect(result.generationId).toBeNull();
  });

  it("empty code is rejected without hitting the RPC", async () => {
    const rpc = vi.fn();
    const result = await consumeRecoveryCode({ rpc }, "user-1", "", "op-4", { env: ENV, auditId: AUDIT });
    expect(result.consumed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates RPC errors (caller reconciles partial failure; never restores codes)", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: new Error("rpc failed") }));
    await expect(
      consumeRecoveryCode({ rpc }, "user-1", presentedCode, "op-5", { env: ENV, auditId: AUDIT })
    ).rejects.toThrow(/rpc failed/);
  });

  it("requires an operationId idempotency key and an auditId", async () => {
    const rpc = vi.fn();
    await expect(
      consumeRecoveryCode({ rpc }, "user-1", presentedCode, "", { env: ENV, auditId: AUDIT })
    ).rejects.toThrow(/operationId/);
    await expect(
      consumeRecoveryCode({ rpc }, "user-1", presentedCode, "op-6", { env: ENV })
    ).rejects.toThrow(/auditId/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
