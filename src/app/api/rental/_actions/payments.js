import { NextResponse } from "next/server";
import { checkRentalPaymentPolicy } from "@/application/rental/checkRentalPaymentPolicy";
import { isPaymentPolicy, PAYMENT_POLICIES } from "@/domains/rental-payment/paymentPolicy";
import { validateFeeInput } from "@/domains/rental-payment/convenienceFee";
import { badRequest, findPolicyTenantIdForCharge, ownerOnlyFeeWriteBlocked, ownerOnlyPolicyWriteBlocked } from "./shared.js";

export async function recordOfflinePayment({ authenticated, body, effectiveOwnerId }) {
  const input = body.payment;
  if (!input?.chargeId || !["cash", "cashiers_check"].includes(input.paymentMethod))
    return badRequest("chargeId and a supported offline payment method are required.");
  const amountCents = Number(input.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return badRequest("A positive payment amount is required.");
  // allowOverpaymentCredit: when true, an amount exceeding the charge's remaining
  // balance is accepted — the applied portion settles the charge and the excess is
  // recorded as an open tenant credit (see rental_tenant_credits) instead of being
  // rejected. Requires the caller's explicit human-gated confirmation (the UI
  // enforces checkbox + CONFIRM); the RPC re-validates everything.
  // tenantId: the tenant the payment (and any credit) is attributed to — validated
  // by the RPC as a member of the charge's lease. idempotencyKey: client-generated
  // per submission intent so a retried POST replays instead of double-recording.
  const tenantId = typeof input.tenantId === "string" && input.tenantId.trim() ? input.tenantId.trim() : null;
  const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim() : null;
  // depositState: "received" (collected, not yet in the bank) or "deposited".
  // Defaults to "received" so un-deposited money is never silently claimed as
  // settled — the form captures it explicitly at record time.
  const depositState = input.depositState === "deposited" ? "deposited" : "received";
  // R11 payment-policy gate (server-side, never client-only): the entered
  // amount must satisfy the tenant's effective policy (per-tenant
  // override, else the portfolio default) before the RPC records
  // anything. Stripe autopay is intentionally exempt -- its amounts are
  // computed from the consented schedule, never tenant-entered.
  const policyTenantId = tenantId || (await findPolicyTenantIdForCharge(authenticated.supabaseClient, effectiveOwnerId, input.chargeId));
  const gate = await checkRentalPaymentPolicy(authenticated.supabaseClient, {
    ownerId: effectiveOwnerId, tenantId: policyTenantId, amountCents,
  });
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 422 });
  const { data, error } = await authenticated.supabaseClient.rpc("record_offline_rental_payment", {
    p_owner_id: effectiveOwnerId, p_charge_id: input.chargeId, p_payment_method: input.paymentMethod,
    p_amount_cents: amountCents, p_received_at: input.receivedAt,
    p_receipt_reference: input.receiptReference || null, p_notes: input.notes || null,
    p_allow_overpayment_credit: input.allowOverpaymentCredit === true,
    p_tenant_id: tenantId, p_idempotency_key: idempotencyKey,
    p_deposit_state: depositState,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, payment: data });
}

export async function setPaymentDepositState({ authenticated, body, effectiveOwnerId }) {
  // Reversible transition between "received / awaiting deposit" and
  // "deposited / settled" for a recorded payment. The RPC validates the
  // state, the payment's existence, and that the payment moved money.
  const depositState = body.depositState === "deposited" ? "deposited" : body.depositState === "received" ? "received" : null;
  if (typeof body.paymentId !== "string" || !body.paymentId.trim() || !depositState)
    return badRequest("paymentId and a valid depositState (received or deposited) are required.");
  const { data, error } = await authenticated.supabaseClient.rpc("set_rental_payment_deposit_state", {
    p_owner_id: effectiveOwnerId, p_payment_id: body.paymentId.trim(), p_deposit_state: depositState,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, payment: data });
}

export async function applyTenantCredit({ authenticated, body, effectiveOwnerId }) {
  const input = body.credit;
  const amountCents = Number(input?.amountCents);
  if (typeof input?.creditId !== "string" || !input.creditId.trim() || typeof input?.chargeId !== "string" || !input.chargeId.trim())
    return badRequest("creditId and chargeId are required.");
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return badRequest("A positive credit amount is required.");
  if (input.ownerConfirmed !== true) return badRequest("Owner confirmation is required to apply a credit.");
  const { data, error } = await authenticated.supabaseClient.rpc("apply_rental_tenant_credit", {
    p_owner_id: effectiveOwnerId, p_credit_id: input.creditId.trim(), p_charge_id: input.chargeId.trim(),
    p_amount_cents: amountCents, p_notes: typeof input.notes === "string" ? input.notes.trim() || null : null,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, application: data });
}

export async function voidTenantCredit({ authenticated, body, effectiveOwnerId }) {
  if (typeof body.creditId !== "string" || !body.creditId.trim()) return badRequest("creditId is required.");
  if (typeof body.reason !== "string" || !body.reason.trim()) return badRequest("A reason is required to void a credit.");
  if (body.ownerConfirmed !== true) return badRequest("Owner confirmation is required to void a credit.");
  const { data, error } = await authenticated.supabaseClient.rpc("void_rental_tenant_credit", {
    p_owner_id: effectiveOwnerId, p_credit_id: body.creditId.trim(), p_reason: body.reason.trim(),
  });
  if (error) throw error;
  return NextResponse.json({ success: true, credit: data });
}

// R12: workspace card convenience fee. The UI sends a human percent
// ("2.95"); the server validates and stores integer basis points. The
// RPC audits every change. Owner/co-owner only: staff may not change
// the percentage charged to tenants.
export async function saveConvenienceFee({ authenticated, body, effectiveOwnerId }) {
  if (await ownerOnlyFeeWriteBlocked(authenticated)) return NextResponse.json({ error: "Only the owner or co-owner can change convenience fee settings." }, { status: 403 });
  const validation = validateFeeInput(body.feePercent);
  if (!validation.ok) return badRequest(validation.message);
  const { data, error } = await authenticated.supabaseClient.rpc("set_rental_card_convenience_fee", {
    p_owner_id: effectiveOwnerId, p_fee_bps: validation.bps,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, convenienceFeeBps: data?.card_convenience_fee_bps ?? validation.bps });
}

export async function savePaymentPolicy({ authenticated, body, effectiveOwnerId }) {
  if (await ownerOnlyPolicyWriteBlocked(authenticated)) return NextResponse.json({ error: "Only the owner or co-owner can change payment policies." }, { status: 403 });
  const policy = typeof body.policy === "string" ? body.policy.trim() : "";
  if (!isPaymentPolicy(policy)) return badRequest(`Payment policy must be one of: ${PAYMENT_POLICIES.join(", ")}.`);
  const { data, error } = await authenticated.supabaseClient.rpc("set_rental_payment_policy", {
    p_owner_id: effectiveOwnerId, p_policy: policy,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, paymentPolicy: data?.payment_policy || policy });
}

export async function savePaymentPolicyTenantOverride({ authenticated, body, effectiveOwnerId }) {
  if (await ownerOnlyPolicyWriteBlocked(authenticated)) return NextResponse.json({ error: "Only the owner or co-owner can change payment policy overrides." }, { status: 403 });
  const input = body.override;
  if (!input?.tenantId) return badRequest("tenantId is required.");
  // null / "inherit" clears the override so the tenant inherits the
  // portfolio default again.
  const policy = input.policy === null || input.policy === undefined || input.policy === "" || input.policy === "inherit"
    ? null : String(input.policy).trim();
  if (policy !== null && !isPaymentPolicy(policy)) return badRequest(`Payment policy must be one of: ${PAYMENT_POLICIES.join(", ")}.`);
  const { data: tenant, error: tenantError } = await authenticated.supabaseClient.from("rental_tenants")
    .select("id").eq("owner_id", effectiveOwnerId).eq("id", input.tenantId).maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) return badRequest("Tenant was not found.");
  const { data, error } = await authenticated.supabaseClient.from("rental_tenants")
    .update({ payment_policy: policy }).eq("owner_id", effectiveOwnerId).eq("id", input.tenantId)
    .select("id, payment_policy").single();
  if (error) throw error;
  return NextResponse.json({ success: true, override: data?.payment_policy || null });
}
