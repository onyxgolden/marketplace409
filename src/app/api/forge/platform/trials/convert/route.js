// SaaS 30-day trial — thin authenticated wrapper around
// forge_app_trial_convert_to_paid. Authority, idempotency, and
// auditing live in the RPC; see src/app/api/forge/auth/_lib/rpcRoute.js.
// One-click conversion of a trial (active or expired) to owner_manual
// access. This is an owner-authorized record, never proof of payment
// (billing/checkout is a separate launch-blocking PR).
import { forgeAuthRpcRoute } from "@/app/api/forge/auth/_lib/rpcRoute";

export async function POST(request) {
  return forgeAuthRpcRoute(request, {
    rpc: "forge_app_trial_convert_to_paid",
    fields: ["owner_id", "app_key", "reason"],
    params: { p_owner_id: "owner_id", p_app_key: "app_key", p_reason: "reason", p_request_id: "request_id" },
  });
}
