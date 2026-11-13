// SaaS Auth PR 1 — thin authenticated wrapper around forge_workspace_invite_create.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_workspace_invite_create",
    fields: ["owner_id", "email", "app_key", "role_key"],
    params: { p_owner_id: "owner_id", p_email: "email", p_app_key: "app_key", p_role_key: "role_key", p_request_id: "request_id" },
  });
}
