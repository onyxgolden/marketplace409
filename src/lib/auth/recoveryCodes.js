// One-time MFA recovery codes (Layer 2).
//
// Format: 10 codes; each code carries 160 bits of CSPRNG entropy (>= 128
// required) and is rendered as 8 groups of 4 Crockford-base32 characters,
// e.g. "KQ7M-9XPA-...". Displayed codes are uppercase; entry is
// case-insensitive and forgives O/0 and I/L/1 transcription mistakes
// (normalizeRecoveryCode). Plaintext exists ONLY in the return value of
// generateRecoveryCodes for one-time display after successful enrollment —
// it is never logged, never persisted, never re-derivable.
//
// Storage contract (supabase/migrations/20261013225100_mfa_recovery_and_latch.sql):
//   mfa_recovery_generations(id uuid pk, user_id, key_version, created_at,
//     invalidated_at) with a partial unique index allowing exactly one
//     ACTIVE (invalidated_at is null) generation per user.
//   mfa_recovery_codes(id uuid pk, generation_id fk, code_digest,
//     consumed_at, consumed_by_operation unique).
// Persist ONLY keyed HMAC digests with the digest key version, the user id,
// and a generation id (see storeRecoveryGeneration). Verification uses
// constant-time comparison against the stored digest.
//
// Regeneration contract (caller-enforced, documented here): regenerating a
// user's codes requires a recent verified AAL2 session bound to a recent
// enrollment ceremony (enforced in the mfa route's issue_recovery_codes
// action) and invalidates the ENTIRE old generation. Consumed codes are
// never restored.
//
// Atomicity contract: consumeRecoveryCode goes through the Postgres RPC
// `mfa_consume_recovery_code(p_user_id uuid, p_code_digest text,
// p_operation_id text, p_audit_id text)` from the same migration, which
// atomically consumes the code AND enters RECOVERY_PENDING (latch +
// operation row + audit row + grandfather-registry deletion) in one
// transaction. One concurrent winner only; replays are bound to
// user+digest. storeRecoveryGeneration goes through
// `mfa_replace_recovery_generation` (per-user advisory lock + invalidate +
// insert in ONE transaction): a failed replacement rolls back entirely and
// the previously valid generation survives.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

// Crockford base32: 0-9, A-Z minus I, L, O, U (the classic confusables).
// 0 and 1 are kept but their lookalikes O, I, L never appear in a code, and
// normalizeRecoveryCode maps typed O->0, I/L->1 so hand transcription forgives.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_GROUPS = 8;
const CODE_GROUP_SIZE = 4;
// 8 groups x 4 chars x 5 bits = 160 bits of entropy per code (>= 128 required).
const CODE_BYTES = 20;
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_KEY_VERSION = 1;

function requiredEnv(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Recovery codes require ${name}.`);
  }
  return value;
}

function encodeCode(bytes) {
  let buffer = 0;
  let bitsInBuffer = 0;
  let out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      out += CODE_ALPHABET[(buffer >>> bitsInBuffer) & 31];
      // Drop the consumed high bits so the buffer stays within 32-bit range.
      buffer &= (1 << bitsInBuffer) - 1;
    }
  }
  if (out.length !== CODE_GROUPS * CODE_GROUP_SIZE) {
    throw new Error("encodeCode produced an unexpected code length.");
  }
  const groups = [];
  for (let i = 0; i < CODE_GROUPS; i += 1) {
    groups.push(out.slice(i * CODE_GROUP_SIZE, (i + 1) * CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Normalize a user-typed code for entry: uppercase, drop grouping dashes and
 * whitespace, map common transcription mistakes (O->0, I/L->1). Displayed
 * codes are always uppercase with dashes; entry is forgiving.
 */
export function normalizeRecoveryCode(code) {
  if (typeof code !== "string") throw new Error("normalizeRecoveryCode requires a code string.");
  return code
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/**
 * Generate 10 one-time recovery codes. Plaintext exists ONLY here — the
 * caller must display them once, require acknowledgement, and drop them.
 * @returns {{ codes: string[], keyVersion: number }}
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("generateRecoveryCodes requires a positive count.");
  }
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(encodeCode(randomBytes(CODE_BYTES)));
  }
  return { codes, keyVersion: RECOVERY_CODE_KEY_VERSION };
}

/** Keyed HMAC digest of a code under (keyVersion, server secret). The code is
 * normalized (see normalizeRecoveryCode) before digesting so entry
 * transcription variants match the stored digest. */
export function deriveCodeDigest(code, keyVersion, env = process.env) {
  if (typeof code !== "string" || code === "") {
    throw new Error("deriveCodeDigest requires a code string.");
  }
  if (!Number.isInteger(keyVersion)) {
    throw new Error("deriveCodeDigest requires an integer key version.");
  }
  const secret = requiredEnv(env, "RECOVERY_DIGEST_KEY");
  const normalized = normalizeRecoveryCode(code);
  if (!/^[0-9A-HJKMNPQRS-TV-Z]{32}$/.test(normalized)) {
    throw new Error("deriveCodeDigest requires a well-formed recovery code.");
  }
  return createHmac("sha256", `${keyVersion}:${secret}`).update(normalized, "utf8").digest("hex");
}

/** Constant-time comparison of a presented code against a stored digest. */
export function verifyRecoveryCodeDigest(code, storedDigest, keyVersion, env = process.env) {
  try {
    const computed = deriveCodeDigest(code, keyVersion, env);
    if (typeof storedDigest !== "string" || storedDigest === "") return false;
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(storedDigest, "hex");
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Persist a recovery generation: ONLY digests, the key version, the user
 * binding, and a generation id. Actual tables (migration):
 *   mfa_recovery_generations(id uuid pk, user_id, key_version, created_at,
 *     invalidated_at) — partial unique index: one ACTIVE generation per user
 *   mfa_recovery_codes(id uuid pk, generation_id fk, code_digest,
 *     consumed_at, consumed_by_operation unique)
 *
 * L2-004: replacement is ONE TRANSACTION via the
 * mfa_replace_recovery_generation RPC (per-user advisory lock, invalidate
 * old, insert generation, insert digests). ANY failure rolls back the whole
 * transaction, so a failed replacement NEVER leaves the previously valid
 * generation destroyed without a replacement. Concurrent issuers serialize;
 * consumed codes are never restored.
 *
 * Marks every prior non-invalidated generation for the user invalidated —
 * regeneration invalidates the entire old generation.
 * @returns {{ generationId: string }}
 */
export async function storeRecoveryGeneration(supabaseAdmin, userId, codes, options = {}) {
  const { keyVersion = RECOVERY_CODE_KEY_VERSION, env = process.env } = options;
  if (!supabaseAdmin) throw new Error("storeRecoveryGeneration requires supabaseAdmin.");
  if (typeof userId !== "string" || userId === "") throw new Error("storeRecoveryGeneration requires userId.");
  if (!Array.isArray(codes) || codes.length === 0) throw new Error("storeRecoveryGeneration requires codes.");

  const digests = codes.map((code) => deriveCodeDigest(code, keyVersion, env));
  const generationId = randomUUID();

  const { data, error } = await supabaseAdmin.rpc("mfa_replace_recovery_generation", {
    p_user_id: userId,
    p_generation_id: generationId,
    p_key_version: keyVersion,
    p_code_digests: digests,
  });
  if (error) throw error;
  if (data !== generationId) {
    throw new Error("mfa_replace_recovery_generation returned an unexpected generation id.");
  }

  return { generationId };
}

/**
 * Atomically consume one recovery code via the `mfa_consume_recovery_code`
 * RPC. One concurrent winner only; the RPC consumes the code AND enters
 * RECOVERY_PENDING (latch + operation + audit + grandfather deletion) in a
 * single transaction. Never restores consumed codes.
 * @returns {{ consumed: boolean, generationId: string | null }}
 */
export async function consumeRecoveryCode(supabaseAdmin, userId, code, operationId, options = {}) {
  const { keyVersion = RECOVERY_CODE_KEY_VERSION, env = process.env, auditId = null } = options;
  if (!supabaseAdmin) throw new Error("consumeRecoveryCode requires supabaseAdmin.");
  if (typeof userId !== "string" || userId === "") throw new Error("consumeRecoveryCode requires userId.");
  if (typeof code !== "string" || code === "") return { consumed: false, generationId: null };
  if (typeof operationId !== "string" || operationId === "") {
    throw new Error("consumeRecoveryCode requires an operationId idempotency key.");
  }
  if (typeof auditId !== "string" || auditId === "") {
    throw new Error("consumeRecoveryCode requires an auditId for the atomic latch entry.");
  }

  const digest = deriveCodeDigest(code, keyVersion, env);
  const { data, error } = await supabaseAdmin.rpc("mfa_consume_recovery_code", {
    p_user_id: userId,
    p_code_digest: digest,
    p_operation_id: operationId,
    p_audit_id: auditId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    consumed: Boolean(row?.consumed),
    generationId: row?.generation_id ?? null,
  };
}
