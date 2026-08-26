// Mirrors the SQL resolve_effective_owner_id() helper
// (supabase/migrations/20260829000100_add_workspace_authorization_helpers.sql) exactly, so the
// JS-side owner resolution used by the 3 root authenticated-application factories and the SQL-side
// RLS/RPC authorization can never disagree -- both read only workspace_members.
//
// Returns the owner_id whose workspace actorUserId is currently authorized to act within: their
// own id if they're a primary owner or have no active co-owner membership, otherwise the owner_id
// of the single workspace they're an active co-owner of (see the workspace-membership plan for the
// "one active workspace per member" design decision, also enforced at the DB level by a partial
// unique index).
//
// This query is subject to normal RLS -- workspace_members_self_select
// (using (member_user_id = auth.uid())) permits exactly this read, no elevated client needed.
export async function resolveEffectiveOwnerId({ supabaseClient, actorUserId }) {
  const { data, error } = await supabaseClient
    .from("workspace_members")
    .select("owner_id")
    .eq("member_user_id", actorUserId)
    .eq("status", "active")
    .eq("role", "co_owner")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve effective owner id: ${error.message}`);
  }

  return data?.owner_id ?? actorUserId;
}
