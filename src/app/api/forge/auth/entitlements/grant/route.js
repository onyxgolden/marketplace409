// SaaS Auth PR 1 — thin authenticated wrapper around forge_app_entitlement_grant.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_app_entitlement_grant",
    fields: ["owner_id", "app_key", "source", "reason"],
    params: { p_owner_id: "owner_id", p_app_key: "app_key", p_source: "source", p_starts_at: "starts_at", p_ends_at: "ends_at", p_reason: "reason", p_request_id: "request_id" },
  });
}
