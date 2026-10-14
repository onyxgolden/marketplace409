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
// Storage contract: persist ONLY keyed HMAC digests with the digest key
// version, the user id, and a generation id (see storeRecoveryGeneration).
// Verification uses constant-time comparison against the stored digest.
//
// Regeneration contract (caller-enforced, documented here): regenerating a
// user's codes requires a recent verified AAL2 session and invalidates the
// ENTIRE old generation. Consumed codes are never restored.
//
// CONFLICT NOTE (2026-10-13): an untracked migration appeared in this
// worktree during this build (supabase/migrations/20261013225100_mfa_recovery_and_latch.sql,
// author unknown — NOT written by this task) naming the consume RPC
// `mfa_consume_recovery_code(p_user_id uuid, p_code_digest text,
// p_operation_id text)` returning (code_id, generation_id, consumed). That
// differs from the brief's `auth_recovery_consume(p_user_id, p_digest,
// p_operation_id)` contract documented below. This client keeps the brief's
// contract per the task's instruction; the mismatch fails CLOSED (unknown
// RPC -> the error propagates, the caller reconciles, consumed codes are
// never restored). Reconcile the name/param before activation.
// Atomicity contract: consumeRecoveryCode goes through the Postgres RPC
// `auth_recovery_consume` (per the Layer 2 migration spec in the brief; the
// RPC itself is NOT created here and NO migration is applied by this change).
// Expected signature:
//
//   auth_recovery_consume(
//     p_user_id text,
//     p_digest text,            -- digest of the presented code
//     p_operation_id text      -- idempotency key
//   ) RETURNS TABLE ( consumed boolean, generation_id uuid )
//
// One concurrent winner only: the RPC consumes (sets consumed_at) inside a
// single transaction and a second concurrent attempt with the same code loses.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
 * binding, and a generation id. Expected tables (migration spec):
 *   mfa_recovery_generations(id uuid pk, user_id, created_at, invalidated_at)
 *   mfa_recovery_codes(generation_id fk, user_id, code_digest, consumed_at,
 *     unique(code_digest))
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

  const { data: generation, error: genError } = await supabaseAdmin
    .from("mfa_recovery_generations")
    .insert({ user_id: userId, key_version: keyVersion })
    .select("id")
    .single();
  if (genError) throw genError;

  const { error: codeError } = await supabaseAdmin.from("mfa_recovery_codes").insert(
    digests.map((codeDigest) => ({
      generation_id: generation.id,
      user_id: userId,
      code_digest: codeDigest,
      key_version: keyVersion,
    }))
  );
  if (codeError) throw codeError;

  // Invalidate every older generation for this user (never restores them).
  const { error: invalidateError } = await supabaseAdmin
    .from("mfa_recovery_generations")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .neq("id", generation.id)
    .is("invalidated_at", null);
  if (invalidateError) throw invalidateError;

  return { generationId: generation.id };
}

/**
 * Atomically consume one recovery code via the `auth_recovery_consume` RPC.
 * One concurrent winner only; sets consumed_at. Never restores consumed codes.
 * @returns {{ consumed: boolean, generationId: string | null }}
 */
export async function consumeRecoveryCode(supabaseAdmin, userId, code, operationId, options = {}) {
  const { keyVersion = RECOVERY_CODE_KEY_VERSION, env = process.env } = options;
  if (!supabaseAdmin) throw new Error("consumeRecoveryCode requires supabaseAdmin.");
  if (typeof userId !== "string" || userId === "") throw new Error("consumeRecoveryCode requires userId.");
  if (typeof code !== "string" || code === "") return { consumed: false, generationId: null };
  if (typeof operationId !== "string" || operationId === "") {
    throw new Error("consumeRecoveryCode requires an operationId idempotency key.");
  }

  const digest = deriveCodeDigest(code, keyVersion, env);
  const { data, error } = await supabaseAdmin.rpc("mfa_consume_recovery_code", {
    p_user_id: userId,
    p_code_digest: digest,
    p_operation_id: operationId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    consumed: Boolean(row?.consumed),
    generationId: row?.generation_id ?? null,
  };
}
