// SaaS Auth PR 1 — thin authenticated wrapper around forge_programmer_grant.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_programmer_grant",
    fields: ["user_id", "reason"],
    params: { p_user_id: "user_id", p_scope: "scope", p_reason: "reason", p_request_id: "request_id" },
  });
}
