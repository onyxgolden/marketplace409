// SaaS Auth PR 1 — thin authenticated wrapper around forge_app_role_assign.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_app_role_assign",
    fields: ["owner_id", "app_key", "user_id", "role_key", "reason"],
    params: { p_owner_id: "owner_id", p_app_key: "app_key", p_user_id: "user_id", p_role_key: "role_key", p_reason: "reason", p_request_id: "request_id" },
  });
}
