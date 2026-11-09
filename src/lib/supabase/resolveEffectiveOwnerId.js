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
//
// UI-density redesign: an explicit workspace switch is supported through the optional
// requestedOwnerId. A requested owner is honored only when it is the actor's own id or the
// owner_id of one of the actor's ACTIVE memberships -- anything else (a typo, a stale
// bookmark, another owner's id) silently falls back to the default resolution above, so a
// crafted ?workspace= param can never widen access. The same membership read backs
// listWorkspacesForActor, which powers the switcher UI.
export async function resolveEffectiveOwnerId({ supabaseClient, actorUserId, requestedOwnerId = null }) {
  const memberships = await listActiveMemberships({ supabaseClient, actorUserId });

  // Default resolution, unchanged: the single active membership's owner, else own id.
  const defaultOwnerId = memberships[0]?.owner_id ?? actorUserId;

  if (typeof requestedOwnerId === "string" && requestedOwnerId.length > 0) {
    if (requestedOwnerId === actorUserId) return actorUserId;
    if (memberships.some((membership) => membership.owner_id === requestedOwnerId)) {
      return requestedOwnerId;
    }
    // Not the actor's own workspace and not an active membership: fall back
    // to the default rather than erroring or widening. Same fail-safe
    // posture as the work-list filters ignoring an invalid status.
  }

  return defaultOwnerId;
}

async function listActiveMemberships({ supabaseClient, actorUserId }) {
  const { data, error } = await supabaseClient
    .from("workspace_members")
    .select("owner_id, role")
    .eq("member_user_id", actorUserId)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to resolve effective owner id: ${error.message}`);
  }

  return data || [];
}

// Every workspace the actor can currently act within, for the workspace
// switcher: their own workspace first, then each active membership. At most
// one active membership can exist (partial unique index), so this list has
// at most two entries. Labels are plain words: no owner display-name source
// exists anywhere in this codebase (owner identity is a bare UUID), so the
// switcher labels the actor's own workspace "My workspace" and any
// membership workspace "Shared workspace" instead of inventing a name.
// A failed listing degrades to own-only (the switcher hides) rather than
// breaking the page that asked.
export async function listWorkspacesForActor({ supabaseClient, actorUserId }) {
  const own = { ownerId: actorUserId, role: "owner", label: "My workspace" };
  let memberships;
  try {
    memberships = await listActiveMemberships({ supabaseClient, actorUserId });
  } catch {
    return [own];
  }
  return [
    own,
    ...memberships.map((membership) => ({
      ownerId: membership.owner_id,
      role: membership.role,
      label: "Shared workspace",
    })),
  ];
}
