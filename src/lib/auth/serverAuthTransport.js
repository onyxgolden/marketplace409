// Server-only Supabase admin transport (Layer 2).
//
// Two exports:
//   createServerAuthClient() — a service-role Supabase client factory. Throws
//     if called in a browser; never lets the service-role key reach client
//     code. Sessions are not persisted or refreshed on this client.
//   adminRecoveryAdapter(client) — the ONLY admin surface recovery flows may
//     touch: deleteFactor and revokeSessions, each requiring an audit id and
//     writing an audit entry. Scoped to recovery/break-glass; it is not a
//     general admin client.
//
// Jason's provider-admin recovery material (Supabase dashboard access,
// break-glass authorization signing) lives OUTSIDE the application by design:
// nothing in this module stores, accepts, or documents those credentials.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

function requiredEnv(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Server auth transport requires ${name}.`);
  }
  return value.trim();
}

/**
 * Server-only service-role client factory. Throws when called in a browser
 * (window/document defined) so the service-role key can never be bundled
 * into client code.
 */
export function createServerAuthClient(env = process.env) {
  if (typeof window !== "undefined" || typeof document !== "undefined") {
    throw new Error("createServerAuthClient is server-only and must never run in a browser.");
  }
  return createClient(
    requiredEnv(env, "NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Narrow recovery-only admin adapter. Recovery and break-glass flows may
 * delete a lost factor and revoke sessions; they may do NOTHING else with
 * the admin client (no listUsers, no updateUser, no invite, no factor
 * creation). Every operation requires a caller-supplied audit id, recorded
 * in `mfa_audit_log` (migration table: id uuid pk, user_id, action, actor,
 * audit_id, metadata, created_at).
 *
 * SDK CONTRACT (locked @supabase/auth-js 2.110.5, verified 2026-10-14):
 * - The admin factor surface is the underscore-prefixed
 *   `_listFactors({ userId })` / `_deleteFactor({ userId, id })`; public
 *   listFactors/deleteFactor DO NOT EXIST in this version.
 * - `admin.signOut(jwt, scope)` revokes by JWT, not by user id: there is no
 *   by-user-id session revocation in this SDK version. The recovery latch
 *   (mfa_security_latch) is therefore the real guard; signOut is
 *   belt-and-braces using the user's own JWT from the recovery request.
 *
 * The recovery latch itself is set/cleared through the recovery flow's own
 * transactional RPCs, not through this adapter.
 */
export function adminRecoveryAdapter(supabaseAdmin) {
  if (!supabaseAdmin) throw new Error("adminRecoveryAdapter requires a server auth client.");

  async function audit(auditId, action, userId, metadata = {}) {
    if (typeof auditId !== "string" || auditId === "") {
      throw new Error("adminRecoveryAdapter operations require an audit id.");
    }
    const { error } = await supabaseAdmin.from("mfa_audit_log").insert({
      id: randomUUID(),
      audit_id: auditId,
      action,
      actor: "gateway",
      user_id: userId,
      metadata,
    });
    if (error) throw error;
  }

  return {
    /**
     * Remove a lost TOTP factor during an authorized recovery.
     * Precondition (caller-enforced): user is in RECOVERY_PENDING with a
     * consumed recovery code, or a valid Jason break-glass authorization.
     */
    async deleteFactor(userId, factorId, auditId) {
      if (typeof userId !== "string" || userId === "") throw new Error("deleteFactor requires userId.");
      if (typeof factorId !== "string" || factorId === "") throw new Error("deleteFactor requires factorId.");
      await audit(auditId, "factor.delete", userId, { factorId });
      const { error } = await supabaseAdmin.auth.admin._deleteFactor({ userId, id: factorId });
      if (error) throw error;
      return { deleted: true };
    },

    /**
     * Revoke sessions using the user's own JWT (belt-and-braces beside the
     * recovery latch, which independently denies old JWTs while revocation
     * propagates). The locked SDK offers no by-user-id revocation:
     * admin.signOut(jwt, 'global') is the only mechanism, so a current
     * user JWT is REQUIRED — callers without one must rely on the latch
     * and say so instead of passing a user id where a JWT belongs.
     */
    async revokeSessions(userJwt, userId, auditId) {
      if (typeof userJwt !== "string" || userJwt === "") {
        throw new Error("revokeSessions requires the user's JWT (the SDK has no by-user-id revocation).");
      }
      if (typeof userId !== "string" || userId === "") throw new Error("revokeSessions requires userId.");
      await audit(auditId, "session.revoke", userId, {});
      const { error } = await supabaseAdmin.auth.admin.signOut(userJwt, "global");
      if (error) throw error;
      return { revoked: true };
    },
  };
}
