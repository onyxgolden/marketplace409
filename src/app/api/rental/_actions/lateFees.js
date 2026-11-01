import { NextResponse } from "next/server";
import { badRequest, id, readOnlyWriteBlocked } from "./shared.js";

export async function saveLateFeeRule({ authenticated, body, effectiveOwnerId }) {
  const input = body.rule;
  if (!input?.leaseId || !input.jurisdictionCode?.trim() || !input.ruleSource?.trim() || input.manualApprovalConfirmed !== true)
    return badRequest("Lease, jurisdiction, rule source, and manual-approval confirmation are required.");
  const graceDays = Number(input.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 31) return badRequest("Grace days must be between 0 and 31.");
  // Controls-sweep G1 (Q-11): a late-fee rule on a cancelled lease must not
  // be created — the Lifecycle panel's unfiltered select used to allow it.
  const { data: ruleLease, error: ruleLeaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", input.leaseId).maybeSingle();
  if (ruleLeaseError) throw ruleLeaseError;
  if (ruleLease?.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  const calculationType = input.calculationType;
  const fixed = calculationType === "fixed" ? Number(input.fixedAmountCents) : null;
  const percentage = calculationType === "percentage" ? Number(input.percentageBasisPoints) : null;
  if ((calculationType === "fixed" && (!Number.isSafeInteger(fixed) || fixed <= 0)) || (calculationType === "percentage" && (!Number.isInteger(percentage) || percentage <= 0)))
    return badRequest("A valid late-fee calculation is required.");
  const { data, error } = await authenticated.supabaseClient.from("rental_late_fee_rules").insert({
    owner_id: effectiveOwnerId, id: id("rental_late_fee_rule", input.id), lease_id: input.leaseId, status: "active",
    jurisdiction_code: input.jurisdictionCode.trim().toUpperCase(), grace_days: graceDays, calculation_type: calculationType,
    fixed_amount_cents: fixed, percentage_basis_points: percentage,
    maximum_amount_cents: input.maximumAmountCents ? Number(input.maximumAmountCents) : null,
    rule_source: input.ruleSource.trim(), requires_manual_approval: true,
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, rule: data });
}

export async function assessLateFee({ authenticated, body, effectiveOwnerId }) {
  if (!body.ruleId || !body.chargeId || !body.reason?.trim() || body.ownerApproved !== true)
    return badRequest("Rule, overdue charge, reason, and explicit owner approval are required.");
  const { data, error } = await authenticated.supabaseClient.rpc("assess_rental_late_fee", {
    p_owner_id: effectiveOwnerId, p_rule_id: body.ruleId, p_charge_id: body.chargeId, p_reason: body.reason.trim(),
  });
  if (error) throw error;
  return NextResponse.json({ success: true, assessment: data });
}

export async function saveLateFeeAutoSettings({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot change late-fee settings." }, { status: 403 });
  const input = body.settings;
  if (!input || typeof input !== "object" || typeof input.enabled !== "boolean") return badRequest("enabled must be boolean.");
  if (input.enabled === true && input.confirmAutoPost !== true) return badRequest("Confirm automatic posting before enabling.");
  const graceDays = Number(input.graceDays);
  const calculationType = input.calculationType;
  const fixed = calculationType === "fixed" ? Number(input.fixedAmountCents) : null;
  const percentage = calculationType === "percentage" ? Number(input.percentageBasisPoints) : null;
  const maximum = input.maximumAmountCents === null || input.maximumAmountCents === undefined || input.maximumAmountCents === "" ? null : Number(input.maximumAmountCents);
  if (input.enabled === true) {
    if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 31) return badRequest("Grace days must be between 0 and 31.");
    if ((calculationType === "fixed" && (!Number.isSafeInteger(fixed) || fixed <= 0)) || (calculationType === "percentage" && (!Number.isInteger(percentage) || percentage <= 0))) return badRequest("A valid late-fee calculation is required.");
    if (maximum !== null && (!Number.isSafeInteger(maximum) || maximum <= 0)) return badRequest("Maximum amount must be positive.");
  }
  const { data, error } = await authenticated.supabaseClient.rpc("set_rental_late_fee_auto_settings", {
    p_owner_id: effectiveOwnerId,
    p_settings: { enabled: input.enabled, graceDays: input.enabled ? graceDays : null,
      calculationType: input.enabled ? calculationType : null,
      fixedAmountCents: input.enabled ? fixed : null,
      percentageBasisPoints: input.enabled ? percentage : null,
      maximumAmountCents: input.enabled ? maximum : null },
  });
  if (error) throw error;
  return NextResponse.json({ success: true, settings: data });
}

export async function saveLateFeeTenantOverride({ authenticated, body, effectiveOwnerId, timestamp }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot change late-fee overrides." }, { status: 403 });
  const input = body.override;
  if (!input?.tenantId) return badRequest("tenantId is required.");
  const { data: tenant, error: tenantError } = await authenticated.supabaseClient.from("rental_tenants")
    .select("id").eq("owner_id", effectiveOwnerId).eq("id", input.tenantId).maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) return badRequest("Tenant was not found.");
  const exempt = input.exempt === true;
  const numOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
  const graceDays = numOrNull(input.graceDays);
  const calculationType = input.calculationType || null;
  const fixed = calculationType === "fixed" ? numOrNull(input.fixedAmountCents) : null;
  const percentage = calculationType === "percentage" ? numOrNull(input.percentageBasisPoints) : null;
  const maximum = numOrNull(input.maximumAmountCents);
  if (!exempt) {
    if (graceDays !== null && (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 31)) return badRequest("Grace days must be between 0 and 31.");
    if (calculationType !== null && !["fixed", "percentage"].includes(calculationType)) return badRequest("Calculation type must be fixed or percentage.");
    if (fixed !== null && (!Number.isSafeInteger(fixed) || fixed <= 0)) return badRequest("Fixed amount must be positive.");
    if (percentage !== null && (!Number.isInteger(percentage) || percentage <= 0)) return badRequest("Percentage must be positive.");
    if (maximum !== null && (!Number.isSafeInteger(maximum) || maximum <= 0)) return badRequest("Maximum amount must be positive.");
  }
  const isEmpty = !exempt && graceDays === null && calculationType === null && maximum === null;
  if (isEmpty) {
    const { error } = await authenticated.supabaseClient.from("rental_late_fee_tenant_overrides")
      .delete().eq("owner_id", effectiveOwnerId).eq("tenant_id", input.tenantId);
    if (error) throw error;
    return NextResponse.json({ success: true, override: null });
  }
  const { data, error } = await authenticated.supabaseClient.from("rental_late_fee_tenant_overrides")
    .upsert({ owner_id: effectiveOwnerId, tenant_id: input.tenantId, exempt,
      grace_days: exempt ? null : graceDays,
      calculation_type: exempt ? null : calculationType,
      fixed_amount_cents: exempt ? null : fixed,
      percentage_basis_points: exempt ? null : percentage,
      maximum_amount_cents: exempt ? null : maximum,
      updated_at: timestamp }, { onConflict: "owner_id,tenant_id" }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, override: data });
}
