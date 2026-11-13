// SaaS Auth PR 1 — thin authenticated wrapper around forge_workspace_invite_revoke.
// Authority, idempotency, and auditing live in the RPC; see
// src/app/api/forge/auth/_lib/rpcRoute.js.
import { forgeAuthRpcRoute } from "../../_lib/rpcRoute.js";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_workspace_invite_revoke",
    fields: ["invitation_id"],
    params: { p_invitation_id: "invitation_id", p_request_id: "request_id" },
  });
}
