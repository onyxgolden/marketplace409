// SaaS 30-day trial — thin authenticated wrapper around
// forge_app_trial_grant. Authority, idempotency, and auditing live
// in the RPC; see src/app/api/forge/auth/_lib/rpcRoute.js.
// One initial 30-day trial per workspace per app, ever.
import { forgeAuthRpcRoute } from "@/app/api/forge/auth/_lib/rpcRoute";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_app_trial_grant",
    fields: ["owner_id", "app_key", "reason"],
    params: { p_owner_id: "owner_id", p_app_key: "app_key", p_reason: "reason", p_request_id: "request_id" },
  });
}
