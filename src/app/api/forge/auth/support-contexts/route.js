// SaaS Auth PR 1 — thin authenticated wrapper around forge_support_context_create.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_support_context_create",
    fields: ["owner_id", "granted_user_id", "purpose", "reason"],
    params: { p_owner_id: "owner_id", p_granted_user_id: "granted_user_id", p_purpose: "purpose", p_reason: "reason", p_allowed_apps: "allowed_apps", p_allowed_actions: "allowed_actions", p_expires_at: "expires_at", p_request_id: "request_id" },
  });
}
