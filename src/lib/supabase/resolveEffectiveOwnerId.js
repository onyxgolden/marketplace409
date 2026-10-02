// Mirrors the SQL resolve_effective_owner_id() helper
// (supabase/migrations/20260829000100_add_workspace_authorization_helpers.sql, extended by
// 20261001060000_r17_roles_granular_permissions.sql) exactly, so the JS-side owner resolution
// used by the 3 root authenticated-application factories and the SQL-side RLS/RPC authorization
// can never disagree -- both read only workspace_members.
//
// Returns the owner_id whose workspace actorUserId is currently authorized to act within: their
// own id if they're a primary owner or have no active membership, otherwise the owner_id of the
// single workspace they're an active member of (see the workspace-membership plan for the
// "one active workspace per member" design decision, also enforced at the DB level by a partial
// unique index).
//
// R17: the co_owner-only filter is gone. Active staff rows (manager / property_manager /
// bookkeeper / maintenance / marketing / read_only) now resolve into the owner's workspace,
// matching the SQL helper. Fine-grained what-they-may-do enforcement lives in the API layer
// (requireRentalPermission); this function answers only whose workspace the actor acts within.
//
// This query is subject to normal RLS -- workspace_members_self_select
// (using (member_user_id = auth.uid())) permits exactly this read, no elevated client needed.
export async function resolveEffectiveOwnerId({ supabaseClient, actorUserId }) {
  const { data, error } = await supabaseClient
    .from("workspace_members")
    .select("owner_id")
    .eq("member_user_id", actorUserId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve effective owner id: ${error.message}`);
  }

  return data?.owner_id ?? actorUserId;
}
