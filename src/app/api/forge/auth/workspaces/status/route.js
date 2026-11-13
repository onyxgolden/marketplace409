// SaaS Auth PR 1 — thin authenticated wrapper around forge_workspace_status_set.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_workspace_status_set",
    fields: ["owner_id", "status", "reason"],
    params: { p_owner_id: "owner_id", p_status: "status", p_reason: "reason", p_request_id: "request_id" },
  });
}
