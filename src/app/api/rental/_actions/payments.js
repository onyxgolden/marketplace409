import { NextResponse } from "next/server";
import { checkRentalPaymentPolicy } from "@/application/rental/checkRentalPaymentPolicy";
import { isPaymentPolicy, PAYMENT_POLICIES } from "@/domains/rental-payment/paymentPolicy";
import { validateFeeInput } from "@/domains/rental-payment/convenienceFee";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
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

// Controls-sweep B2: void a settled OFFLINE payment. The row moves to the
// refunded state (not a invented "voided" state) because that is the state
// the database reversal trigger watches: it restores the charge's paid amount
// and posts the ledger reversal event. The void reason is appended to notes so
// the ledger still reads as a void, not a tenant refund. A deposited payment
// is refused — the bank record must be corrected first — and Stripe payments
// are never voided here; they go through refundPayment below.
export async function voidPayment({ authenticated, body, effectiveOwnerId }) {
  if (typeof body.paymentId !== "string" || !body.paymentId.trim()) return badRequest("paymentId is required.");
  if (typeof body.reason !== "string" || !body.reason.trim()) return badRequest("A reason is required to void a payment.");
  if (body.ownerConfirmed !== true) return badRequest("Owner confirmation is required to void a payment.");
  const paymentId = body.paymentId.trim();
  const { data: payment, error } = await authenticated.supabaseClient.from("rental_payments")
    .select("id, provider, status, amount_cents, deposit_state, notes")
    .eq("owner_id", effectiveOwnerId).eq("id", paymentId).maybeSingle();
  if (error) throw error;
  if (!payment) return NextResponse.json({ error: "Payment was not found." }, { status: 404 });
  if (payment.provider !== "offline") return NextResponse.json({ error: "Only offline payments can be voided here. Refund a Stripe payment instead." }, { status: 409 });
  if (payment.status !== "succeeded") return NextResponse.json({ error: "Only a settled offline payment can be voided." }, { status: 409 });
  if (payment.deposit_state === "deposited") return NextResponse.json({ error: "This payment is marked deposited. Mark it as awaiting deposit first, then void it." }, { status: 409 });
  const notes = [payment.notes, `Voided: ${body.reason.trim()}`].filter(Boolean).join(" ");
  const { data: updated, error: updateError } = await authenticated.supabaseClient.from("rental_payments")
    .update({ status: "refunded", refunded_amount_cents: payment.amount_cents, notes, updated_at: new Date().toISOString() })
    .eq("owner_id", effectiveOwnerId).eq("id", paymentId).eq("status", "succeeded")
    .select("id, charge_id, status, amount_cents, refunded_amount_cents").maybeSingle();
  if (updateError) throw updateError;
  if (!updated) return NextResponse.json({ error: "Payment could not be voided." }, { status: 409 });
  return NextResponse.json({ success: true, payment: updated });
}

// Controls-sweep B2: refund a settled STRIPE payment. Refunds the full
// remaining amount (amount minus any earlier partial refund) on the connected
// account, then marks the row refunded so the same reversal trigger restores
// the charge balance. The Stripe call runs before the row update so a failed
// refund never touches the ledger.
export async function refundPayment({ authenticated, body, effectiveOwnerId }) {
  if (typeof body.paymentId !== "string" || !body.paymentId.trim()) return badRequest("paymentId is required.");
  if (body.ownerConfirmed !== true) return badRequest("Owner confirmation is required to refund a payment.");
  const paymentId = body.paymentId.trim();
  const { data: payment, error } = await authenticated.supabaseClient.from("rental_payments")
    .select("id, provider, provider_mode, provider_payment_id, amount_cents, refunded_amount_cents, status")
    .eq("owner_id", effectiveOwnerId).eq("id", paymentId).maybeSingle();
  if (error) throw error;
  if (!payment) return NextResponse.json({ error: "Payment was not found." }, { status: 404 });
  if (payment.provider !== "stripe") return NextResponse.json({ error: "Only Stripe payments can be refunded here. Void an offline payment instead." }, { status: 409 });
  if (!["succeeded", "partially_refunded"].includes(payment.status)) return NextResponse.json({ error: "Only a settled Stripe payment can be refunded." }, { status: 409 });
  if (typeof payment.provider_payment_id !== "string" || !payment.provider_payment_id.trim()) return NextResponse.json({ error: "This Stripe payment has no payment reference to refund." }, { status: 409 });
  const remaining = payment.amount_cents - (payment.refunded_amount_cents || 0);
  if (remaining <= 0) return NextResponse.json({ error: "This payment is already fully refunded." }, { status: 409 });
  const { data: account, error: accountError } = await authenticated.supabaseClient.from("landlord_payment_accounts")
    .select("provider_account_id").eq("owner_id", effectiveOwnerId).eq("provider", "stripe").eq("provider_mode", payment.provider_mode).maybeSingle();
  if (accountError) throw accountError;
  if (!account) return NextResponse.json({ error: "No connected Stripe account was found for this payment." }, { status: 409 });
  const provider = createStripeBillingProvider();
  const refund = await provider.createRefund({ connectedAccountId: account.provider_account_id },
    { paymentIntentId: payment.provider_payment_id, paymentId: payment.id, amountCents: remaining },
    `refund:${payment.id}:${remaining}`);
  const { data: updated, error: updateError } = await authenticated.supabaseClient.from("rental_payments")
    .update({ status: "refunded", refunded_amount_cents: payment.amount_cents, updated_at: new Date().toISOString() })
    .eq("owner_id", effectiveOwnerId).eq("id", paymentId)
    .select("id, charge_id, status, amount_cents, refunded_amount_cents").maybeSingle();
  if (updateError) throw updateError;
  if (!updated) return NextResponse.json({ error: "Payment could not be marked refunded after Stripe accepted the refund." }, { status: 409 });
  return NextResponse.json({ success: true, payment: updated, refund });
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
