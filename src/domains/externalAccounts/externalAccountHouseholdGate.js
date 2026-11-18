// FORGE External Accounts Register — household gate.
//
// The register is for the owning household only: Jason (primary owner)
// and Brandy (active co-owner). This wrapper is
//   isOwnerOrActiveCoOwner AND no suspended rows
// and exists because the shared helper has a known gap: it returns
// true when there is NO active membership row, which is correct for a
// primary owner (owners never have a workspace_members row) but ALSO
// true for a suspended (revoked) co-owner, whose only row is
// suspended. A revoked co-owner must see nothing.
//
// This is a UI/API pre-check only. The database is the real
// enforcement: forge_external_account_actor_may_act() denies the same
// identities (active staff roles in any workspace, any suspended
// membership) in every RLS policy and RPC gate, so a caller who
// reaches the RPC directly gets the same answer.
//
// Do NOT "fix" this by changing the shared helper — that helper also
// gates the Health tile, and changing it is out of scope for this
// slice. The suspended-row gap in the shared helper is recorded as a
// follow-up in the PR body.

import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";

/**
 * True only when the actor is the household (primary owner or active
 * co-owner) with no suspended membership anywhere.
 */
export async function isRegisterHouseholdActor({ supabaseClient, actorUserId }) {
  if (!actorUserId) return false;

  const household = await isOwnerOrActiveCoOwner({ supabaseClient, actorUserId });
  if (!household) return false;

  // A suspended row anywhere revokes the household answer above: a
  // revoked co-owner has no ACTIVE row, so the helper above says
  // "owner" — this query is what catches them.
  const { data, error } = await supabaseClient
    .from("workspace_members")
    .select("status")
    .eq("member_user_id", actorUserId)
    .eq("status", "suspended");

  if (error) {
    throw new Error(`Failed to resolve workspace membership: ${error.message}`);
  }

  return (data ?? []).length === 0;
}
