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
  function mockAdmin() {
    const inserted = { codes: [], generations: [] };
    const calls = [];
    const admin = {
      inserted,
      calls,
      from: vi.fn((table) => {
        if (table === "mfa_recovery_generations") {
          return {
            // L2-004 order: invalidation FIRST (update), then insert.
            update: vi.fn((row) => {
              calls.push({ table, op: "update", row });
              return {
                eq: vi.fn(() => ({
                  is: vi.fn(() => Promise.resolve({ error: null })),
                })),
              };
            }),
            insert: vi.fn((row) => {
              calls.push({ table, op: "insert", row });
              inserted.generations.push(row);
              return Promise.resolve({ error: null });
            }),
          };
        }
        return {
          insert: vi.fn((rows) => {
            inserted.codes.push(...rows);
            return Promise.resolve({ error: null });
          }),
        };
      }),
    };
    return admin;
  }

  it("L2-004: invalidates the old generation BEFORE inserting (partial-unique safe)", async () => {
    const admin = mockAdmin();
    const { codes } = generateRecoveryCodes();
    await storeRecoveryGeneration(admin, "user-1", codes, { env: ENV });
    const ops = admin.calls.map((c) => c.op);
    expect(ops).toEqual(["update", "insert"]);
    const updateCall = admin.calls[0];
    expect(updateCall.row.invalidated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("L2-004: supplies explicit UUIDs and only real columns", async () => {
    const admin = mockAdmin();
    const { codes } = generateRecoveryCodes();
    const { generationId } = await storeRecoveryGeneration(admin, "user-1", codes, { env: ENV });
    expect(generationId).toMatch(UUID_RE);

    const genRow = admin.inserted.generations[0];
    expect(genRow.id).toBe(generationId);
    expect(genRow).toMatchObject({ user_id: "user-1", key_version: 1 });
    // The generation row carries no invented columns.
    expect(Object.keys(genRow).sort()).toEqual(["id", "key_version", "user_id"]);

    expect(admin.inserted.codes).toHaveLength(RECOVERY_CODE_COUNT);
    const codeIds = new Set();
    for (const row of admin.inserted.codes) {
      expect(row.id).toMatch(UUID_RE);
      codeIds.add(row.id);
      expect(row.generation_id).toBe(generationId);
      expect(row.code_digest).toMatch(/^[0-9a-f]{64}$/);
      // Codes table has NO user_id / key_version columns: only real columns.
      expect(Object.keys(row).sort()).toEqual(["code_digest", "generation_id", "id"]);
      // Plaintext must never be persisted: no stored field may equal a code.
      for (const code of codes) {
        expect(Object.values(row).includes(code)).toBe(false);
      }
      // Each stored digest verifies against exactly one presented code.
      const match = codes.filter((c) => verifyRecoveryCodeDigest(c, row.code_digest, 1, ENV));
      expect(match).toHaveLength(1);
    }
    expect(codeIds.size).toBe(RECOVERY_CODE_COUNT);
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
