// Answers a narrower question than resolveEffectiveOwnerId: not "whose data does this actor act
// within" but "is this actor the household itself (the primary owner or their invited spouse/
// co-owner), as opposed to staff (manager, bookkeeper, read_only)". Used to gate FORGE surfaces
// that are for the owning family only, never the wider team -- e.g. the private Health workspace
// tile on the FORGE dashboard.
//
// A primary owner never has a workspace_members row for their own workspace (see the
// workspace_members_role_check1 constraint: role <> 'primary_owner'), so "no active membership
// row at all" means primary owner, exactly like resolveEffectiveOwnerId's own fallback. An active
// co_owner row means the invited spouse. Any other role is staff, not household.
export async function isOwnerOrActiveCoOwner({ supabaseClient, actorUserId }) {
  const { data, error } = await supabaseClient
    .from("workspace_members")
    .select("role")
    .eq("member_user_id", actorUserId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve workspace role: ${error.message}`);
  }

  return !data || data.role === "co_owner";
}
