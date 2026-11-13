// SaaS Auth PR 1 — thin authenticated wrapper around forge_provision_workspace.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_provision_workspace",
    fields: ["display_name"],
    params: { p_display_name: "display_name", p_request_id: "request_id" },
  });
}
