import { NextResponse } from "next/server";
import { badRequest, readOnlyWriteBlocked } from "./shared.js";

// Controls-sweep follow-up G22 (O-13): landlord-side insurance paths.
// The tenant submission RPC resolves the tenant from auth.uid() and the
// review RPC only moves pending_verification rows, so all three ops below
// work owner-side against the lease household (primary tenant, else first
// member) and the policy row directly.
//
// Paper proof: the landlord's evidence reference is free text naming where
// the paper proof is filed (the policies table carries evidence_id as
// plain text with no FK). It satisfies the verified CHECK on review
// (verified requires verified_at + evidence_id or provider id) without
// inventing a file row the landlord never uploaded.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function householdTenantId({ authenticated, effectiveOwnerId, leaseId }) {
  const { data: members, error } = await authenticated.supabaseClient.from("rental_lease_tenants")
    .select("tenant_id, occupancy_role").eq("owner_id", effectiveOwnerId).eq("lease_id", leaseId);
  if (error) throw error;
  return (members || []).find((row) => row.occupancy_role === "primary")?.tenant_id
    || (members || [])[0]?.tenant_id || null;
}

function validateProofInput(input) {
  if (typeof input.carrierName !== "string" || input.carrierName.trim() === "")
    return "Carrier name is required.";
  if (typeof input.policyNumberMasked !== "string" || input.policyNumberMasked.trim() === "")
    return "A policy number is required.";
  const limit = Number(input.liabilityLimitCents);
  if (!Number.isSafeInteger(limit) || limit < 0)
    return "A nonnegative liability limit (cents) is required.";
  if (!DATE_RE.test(input.effectiveDate || "") || !DATE_RE.test(input.expirationDate || ""))
    return "Effective and expiration dates (YYYY-MM-DD) are required.";
  if (input.expirationDate < input.effectiveDate)
    return "Expiration date cannot be before the effective date.";
  if (typeof input.evidenceReference !== "string" || input.evidenceReference.trim() === "")
    return "An evidence reference is required — where the paper proof is filed.";
  return null;
}

export async function recordInsuranceProof({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot record insurance proof." }, { status: 403 });
  const input = body.policy || {};
  if (typeof input.leaseId !== "string" || input.leaseId.trim() === "")
    return badRequest("A lease is required.");
  const problem = validateProofInput(input);
  if (problem) return badRequest(problem);
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", input.leaseId.trim()).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
  if (lease.status !== "active")
    return NextResponse.json({ error: "Insurance proof can only be recorded against an active lease." }, { status: 409 });
  const tenantId = await householdTenantId({ authenticated, effectiveOwnerId, leaseId: lease.id });
  if (!tenantId)
    return NextResponse.json({ error: "The lease has no tenants to record proof against." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("renters_insurance_policies").insert({
    owner_id: effectiveOwnerId, id: `renters_policy_${crypto.randomUUID()}`, tenant_id: tenantId, lease_id: lease.id,
    carrier_name: input.carrierName.trim(), policy_number_masked: input.policyNumberMasked.trim(),
    liability_limit_cents: Number(input.liabilityLimitCents), effective_date: input.effectiveDate,
    expiration_date: input.expirationDate, status: "pending_verification",
    evidence_id: input.evidenceReference.trim(), last_checked_at: new Date().toISOString(),
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, policy: data });
}

export async function updateInsuranceProof({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit insurance proof." }, { status: 403 });
  const input = body.policy || {};
  if (!input?.id) return badRequest("Policy id is required.");
  const problem = validateProofInput(input);
  if (problem) return badRequest(problem);
  const { data: policy, error: loadError } = await authenticated.supabaseClient.from("renters_insurance_policies")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", input.id).maybeSingle();
  if (loadError) throw loadError;
  if (!policy) return NextResponse.json({ error: "Policy was not found." }, { status: 404 });
  // Decided rows are compliance history: correct them by reopening (for
  // re-review) or recording a replacement, never by rewriting.
  if (policy.status !== "pending_verification")
    return NextResponse.json({ error: "Only a pending policy can be edited — reopen a decided policy for re-review, or record a replacement." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("renters_insurance_policies").update({
    carrier_name: input.carrierName.trim(), policy_number_masked: input.policyNumberMasked.trim(),
    liability_limit_cents: Number(input.liabilityLimitCents), effective_date: input.effectiveDate,
    expiration_date: input.expirationDate, evidence_id: input.evidenceReference.trim(),
    updated_at: new Date().toISOString(),
  }).eq("owner_id", effectiveOwnerId).eq("id", input.id).select("*").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Policy was not found." }, { status: 404 });
  return NextResponse.json({ success: true, policy: data });
}

export async function reopenInsurancePolicy({ authenticated, body, effectiveOwnerId, timestamp }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot reopen insurance policies." }, { status: 403 });
  if (!body.policyId) return badRequest("Policy id is required.");
  const { data: policy, error: loadError } = await authenticated.supabaseClient.from("renters_insurance_policies")
    .select("id, status, expiration_date").eq("owner_id", effectiveOwnerId).eq("id", body.policyId).maybeSingle();
  if (loadError) throw loadError;
  if (!policy) return NextResponse.json({ error: "Policy was not found." }, { status: 404 });
  const today = (timestamp || new Date().toISOString()).slice(0, 10);
  const reopenable = policy.status === "rejected" || policy.status === "expired"
    || (policy.status === "verified" && policy.expiration_date < today);
  if (!reopenable) {
    if (policy.status === "pending_verification")
      return NextResponse.json({ error: "This policy is already pending verification." }, { status: 409 });
    if (policy.status === "verified")
      return NextResponse.json({ error: "This policy is verified and still in force — it cannot be reopened." }, { status: 409 });
    return NextResponse.json({ error: `A ${policy.status} policy cannot be reopened.` }, { status: 409 });
  }
  const { data, error } = await authenticated.supabaseClient.from("renters_insurance_policies").update({
    status: "pending_verification", verified_at: null, verification_provider: null, updated_at: new Date().toISOString(),
  }).eq("owner_id", effectiveOwnerId).eq("id", policy.id).select("id, status").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Policy was not found." }, { status: 404 });
  return NextResponse.json({ success: true, policy: data });
}
