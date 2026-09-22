// Returns the actor's active workspace_members role, or null when the actor has no active
// membership row (a primary owner acting in their own workspace, or a non-member acting in
// their own fallback workspace).
//
// A primary owner never has a workspace_members row for their own workspace (see the
// workspace_members_role_check1 constraint: role <> 'primary_owner'), so "no row" means the
// actor is not staff of any workspace. The one-active-workspace-per-member design (partial
// unique index) means at most one row is ever returned.
//
// This deliberately does NOT filter by owner: resolveEffectiveOwnerId() only elevates an
// active co_owner into the owner's workspace, so a read_only member's effective owner id is
// their own id -- filtering by it would miss their membership row entirely and the read_only
// check would never fire. Callers decide what a role is allowed to do.
//
// This query is subject to normal RLS -- workspace_members_self_select
// (using (member_user_id = auth.uid())) permits exactly this read, no elevated client needed.
export async function getActiveWorkspaceRole({ supabaseClient, actorUserId }) {
  const { data, error } = await supabaseClient
    .from("workspace_members")
    .select("role")
    .eq("member_user_id", actorUserId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve workspace role: ${error.message}`);
  }

  return data?.role ?? null;
}
