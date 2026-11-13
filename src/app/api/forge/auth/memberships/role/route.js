// SaaS Auth PR 1 — thin authenticated wrapper around forge_workspace_membership_role_set.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_workspace_membership_role_set",
    fields: ["owner_id", "user_id", "role"],
    params: { p_owner_id: "owner_id", p_user_id: "user_id", p_role: "role", p_request_id: "request_id" },
  });
}
