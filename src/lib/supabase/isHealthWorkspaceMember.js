// Answers whether the signed-in user is a member of the private health
// workspace (health_workspace_members) -- the gate for the Health tile on
// the FORGE apps page (Jason's Nov 18 decision: the tile shows only to
// health-workspace members, i.e. Jason + Brandy; never to staff, and
// never by a hardcoded email list).
//
// Unlike isOwnerOrActiveCoOwner, a query failure HIDES the tile (returns
// false) instead of throwing: the tile is a convenience link, and the
// records themselves stay behind /forge/health's own RLS-enforced
// access, so a failed visibility check must never break the shared
// dashboard. Same query shape as src/app/forge/health/page.jsx.
export async function isHealthWorkspaceMember({ supabaseClient, actorUserId }) {
  try {
    const { data, error } = await supabaseClient
      .from("health_workspace_members")
      .select("workspace_id,role")
      .eq("user_id", actorUserId)
      .maybeSingle();

    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}
