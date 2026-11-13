// SaaS Auth PR 1 — thin authenticated wrapper around forge_platform_operator_revoke.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_platform_operator_revoke",
    fields: ["user_id", "reason"],
    params: { p_user_id: "user_id", p_reason: "reason", p_request_id: "request_id" },
  });
}
