// SaaS 30-day trial — owner console reads.
//
// GET /api/forge/platform/trials?workspace=<owner_id> returns the
// overview for one workspace (entitlements, trial history, audit,
// availability). GET without workspace returns the workspace list
// (?search= filters by display name). Both read through the
// platform-owner-only RPCs; a non-owner gets 403 and learns nothing
// about whether a workspace exists. No appKey is passed to the auth
// helper: the trial console must be reachable before any app is
// active, and each RPC enforces its own authority.
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { errorResponse } from "@/app/api/forge/auth/_lib/rpcRoute";

export async function GET(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const url = new URL(request.url);
  const workspace = url.searchParams.get("workspace");
  const search = url.searchParams.get("search") ?? "";

  if (workspace) {
    const { data, error } = await authenticated.supabaseClient.rpc("forge_platform_trial_overview", {
      p_owner_id: workspace,
    });
    if (error) return errorResponse(error);
    return NextResponse.json({ ok: true, ...data }, { status: 200 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc("forge_platform_trial_workspace_list", {
    p_search: search,
  });
  if (error) return errorResponse(error);
  return NextResponse.json({ ok: true, workspaces: data }, { status: 200 });
}
