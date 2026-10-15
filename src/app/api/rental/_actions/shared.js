import { NextResponse } from "next/server";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";

export function badRequest(message) { return NextResponse.json({ error: message }, { status: 400 }); }
export function now() { return new Date().toISOString(); }
export function id(prefix, supplied) { return supplied?.trim() || `${prefix}_${crypto.randomUUID()}`; }

// A read_only workspace member is blocked outright on lease/schedule writes: the role name
// promises no writes, so the write must not happen even though scoping alone would only
// divert it into the actor's own fallback workspace. Non-members (no membership row) keep
// the scoping behavior -- their writes land under their own id and can never touch this
// workspace. See getActiveWorkspaceRole.js for why the lookup is by actor, not by owner.
export async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

// R11: payment-policy mutations are owner/co-owner only (the Rentec parity contract).
// Staff -- manager, bookkeeper, read_only -- may not change the portfolio policy or a
// tenant override. isOwnerOrActiveCoOwner answers exactly this question: the primary
// owner (no membership row) or an active co_owner is the owning household, never staff.
export async function ownerOnlyPolicyWriteBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}
// R12: the card convenience-fee percentage is owner/co-owner only (the Rentec parity
// contract). Staff -- manager, bookkeeper, read_only -- may not change the percentage
// charged to tenants. isOwnerOrActiveCoOwner answers exactly this question: the primary
// owner (no membership row) or an active co_owner is the owning household, never staff.
// The set_rental_card_convenience_fee RPC re-checks has_workspace_access
// (owner-or-active-co_owner only) as defense in depth behind this route gate.
export async function ownerOnlyFeeWriteBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}

// R11: for the payment-policy gate on manual payment recording, the tenant is
// the explicitly supplied tenantId when given, otherwise the charge's primary
// lease member. Returns null when nothing is derivable -- the gate then fails
// open to the portfolio default (never newly blocking a payment).
export async function findPolicyTenantIdForCharge(supabaseClient, ownerId, chargeId) {
  const { data: charge } = await supabaseClient.from("rent_charges").select("lease_id")
    .eq("owner_id", ownerId).eq("id", chargeId).maybeSingle();
  if (!charge?.lease_id) return null;
  const { data: memberships } = await supabaseClient.from("rental_lease_tenants").select("tenant_id, occupancy_role")
    .eq("owner_id", ownerId).eq("lease_id", charge.lease_id);
  if (!memberships?.length) return null;
  return (memberships.find((row) => row.occupancy_role === "primary") || memberships[0]).tenant_id;
}
