import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { isAutopayCollectibleChargeType } from "./tenantCharges.js";
import { autopayFeeCents, resolveFeeBasisPoints } from "@/domains/rental-payment/convenienceFee";

// Extracted so both the manual /api/rental/autopay/execute endpoint and the
// autopay-sweep cron can attempt a single (enrollment, charge) pair identically.
export async function executeAutopayAttempt(db, enrollmentId, chargeId) {
  if (!enrollmentId || !chargeId) return { httpStatus: 400, body: { error: "Enrollment and charge are required." } };

  const [{ data: enrollment, error: enrollmentError }, { data: charge, error: chargeError }] = await Promise.all([
    db.from("rental_autopay_enrollments").select("*").eq("id", enrollmentId).eq("status", "active").single(),
    db.from("rent_charges").select("*").eq("id", chargeId).in("status", ["scheduled", "due", "partially_paid", "overdue"]).single(),
  ]);
  if (enrollmentError || chargeError || !enrollment || !charge || enrollment.owner_id !== charge.owner_id || enrollment.lease_id !== charge.lease_id)
    return { httpStatus: 409, body: { error: "Active matching autopay and charge are required." } };

  // Defense in depth for the manual execute endpoint: only rent/proration/
  // late_fee are eligible for AUTOMATIC collection. Tenants may still pay any
  // valid charge type voluntarily through the portal — this gate never runs
  // on that path.
  if (!isAutopayCollectibleChargeType(charge.charge_type))
    return { httpStatus: 409, body: { error: "This charge type is not eligible for autopay." } };

  const existing = await db.from("rental_autopay_attempts").select("*")
    .eq("owner_id", enrollment.owner_id).eq("enrollment_id", enrollment.id).eq("charge_id", charge.id).maybeSingle();
  if (existing.error) throw existing.error;

  // Retry gate (fail-closed): a failed/cancelled attempt may be retried with
  // a FRESH idempotency key ONLY when the stored failure is a definitive
  // pre-creation rejection — a Stripe error type that guarantees no
  // PaymentIntent was ever created (400 request validation, 401/403 auth,
  // 429 rate limit). A bare null provider_payment_id is NOT proof: Stripe
  // can accept the create+confirm request and start the debit while the
  // response is lost (network drop, 5xx), leaving the local row failed with
  // no ID — retrying that with a fresh key would double-charge. Those
  // ambiguous outcomes (connection errors, server errors, card errors,
  // idempotency errors, unknown/legacy failures) stay blocked for manual
  // reconciliation. Anything else keeps the old duplicate short-circuit.
  // (ChatGPT exact-head review 2026-10-02 NO-GO'd the null-ID-only gate on
  // this exact double-charge path.)
  const DEFINITIVE_PRE_CREATION_REJECTION = new Set([
    "StripeInvalidRequestError",
    "StripeAuthenticationError",
    "StripePermissionError",
    "StripeRateLimitError",
  ]);
  const retryable = !!existing.data
    && (existing.data.status === "failed" || existing.data.status === "cancelled")
    && !existing.data.provider_payment_id
    && DEFINITIVE_PRE_CREATION_REJECTION.has(existing.data.failure_code);
  if (existing.data && !retryable)
    return { httpStatus: 200, body: { success: true, duplicate: true, attempt: existing.data } };

  // In-flight payment guard: the tenant portal's manual payment flow refuses to start a
  // second payment while one is pending for the charge — autopay must honor the same rule.
  // Without it, a tenant who pays early by ACH (which settles days later, leaving the charge
  // "due" with paid_amount_cents still at 0) would be charged again in full by the sweep.
  // Settled early payments need no extra check: the webhook posts them to the charge ledger,
  // so `remaining` below already debits only what's still unpaid (and a fully-paid charge is
  // not even eligible above). Scoped to the enrollment's provider_mode like everything else.
  const inFlight = await db.from("rental_payments").select("id")
    .eq("owner_id", enrollment.owner_id).eq("charge_id", charge.id)
    .eq("provider_mode", enrollment.provider_mode)
    .in("status", ["created", "requires_payment_method", "requires_action", "processing"]).maybeSingle();
  if (inFlight.error) throw inFlight.error;
  if (inFlight.data)
    return { httpStatus: 200, body: { success: true, skipped: true, chargeId: charge.id, reason: "payment_pending" } };

  const remaining = Number(charge.amount_cents) - Number(charge.paid_amount_cents);
  // Defensive: a zero (or negative) remainder must never reach Stripe as a debit — the
  // webhook normally flips a fully-paid charge to "paid" (ineligible above), but if the
  // ledger ever disagrees, skip instead of attempting a $0 charge (which would fail at
  // Stripe and wrongly count against the enrollment's retry limit).
  if (remaining <= 0)
    return { httpStatus: 200, body: { success: true, skipped: true, chargeId: charge.id, reason: "already_paid" } };

  // Central collection-authority gate for BOTH callers of this function (the sweep cron and any
  // manual execute endpoint): a schedule that isn't FORGE-collectible as of today must never be
  // auto-charged, even if a charge/enrollment pair otherwise looks eligible.
  const schedule = await db.from("rent_schedules").select("collection_mode, forge_cutover_date")
    .eq("owner_id", enrollment.owner_id).eq("lease_id", enrollment.lease_id).eq("status", "active")
    .order("effective_start_date", { ascending: false }).limit(1).maybeSingle();
  if (schedule.error) throw schedule.error;
  const today = new Date().toISOString().slice(0, 10);
  const isForgeCollectible = schedule.data?.collection_mode === "forge"
    && schedule.data.forge_cutover_date !== null && schedule.data.forge_cutover_date <= today;
  if (!isForgeCollectible) return { httpStatus: 409, body: { error: "This lease is not currently collected through FORGE." } };

  // Owner-level master pause overrides an otherwise-eligible per-schedule cutover: autopay must
  // never execute while the owner's rental billing is globally paused, even for a lease whose
  // schedule is individually FORGE-activated with an arrived cutover date.
  const billingSettings = await db.from("rental_billing_settings").select("billing_enabled, card_convenience_fee_bps")
    .eq("owner_id", enrollment.owner_id).maybeSingle();
  if (billingSettings.error) throw billingSettings.error;
  if (!billingSettings.data?.billing_enabled) return { httpStatus: 409, body: { error: "Rental online billing is currently paused for this owner." } };

  // Scoped to the *enrollment's own* provider_mode, not just the current server mode: a payment
  // method/mandate token is only ever valid within the mode it was created under, so the
  // connected account charged here must always match that same mode — this is what makes it
  // impossible for a sandbox payment method to ever be charged against a live connected account.
  const account = await db.from("landlord_payment_accounts").select("*")
    .eq("owner_id", enrollment.owner_id).eq("provider", "stripe").eq("provider_mode", enrollment.provider_mode).single();
  if (account.error || !account.data?.provider_account_id) throw account.error || new Error("Stripe account missing");

  const paymentId = `rental_payment_${crypto.randomUUID()}`;
  // Retry attempts get their own idempotency key: the original key already
  // lives on the failed payment row (unique(idempotency_key)), and a fresh
  // key guarantees Stripe can never replay the dead attempt.
  const key = retryable
    ? `autopay:${enrollment.id}:${charge.id}:retry:${crypto.randomUUID().slice(0, 8)}`
    : `autopay:${enrollment.id}:${charge.id}`;
  const timestamp = new Date().toISOString();

  // R12: card autopay carries the convenience fee ONLY with the tenant's
  // explicit portal consent, at the consented rate capped at the current
  // workspace rate (see autopayFeeCents). ACH autopay never carries a fee.
  // fee_agreed_at is the tenant's original consent timestamp -- the tenant
  // agreed in the portal at enrollment time, not at each sweep.
  const feeCents = autopayFeeCents({ paymentMethodType: enrollment.payment_method_type,
    consentBps: enrollment.fee_consent_bps,
    workspaceBps: resolveFeeBasisPoints(billingSettings.data?.card_convenience_fee_bps),
    rentCents: remaining });
  const totalCents = remaining + feeCents;

  const payment = await db.from("rental_payments").insert({
    owner_id: enrollment.owner_id, id: paymentId, charge_id: charge.id, lease_id: charge.lease_id, tenant_id: enrollment.tenant_id,
    provider: "stripe", provider_mode: enrollment.provider_mode, provider_customer_id: enrollment.provider_customer_id, amount_cents: totalCents, refunded_amount_cents: 0,
    convenience_fee_cents: feeCents, convenience_fee_bps: feeCents > 0 ? enrollment.fee_consent_bps : null,
    fee_agreed_at: feeCents > 0 ? (enrollment.fee_consented_at || timestamp) : null,
    currency_code: charge.currency_code, status: "created", idempotency_key: key, created_at: timestamp, updated_at: timestamp,
  }).select("*").single();
  if (payment.error) throw payment.error;

  // No migration needed: unique(owner_id,enrollment_id,charge_id) forbids a
  // second attempt row, so a retry transitions the failed row in place. The
  // old failed payment row keeps the original failure as the audit trail.
  // The status predicate is an optimistic-concurrency guard — if another
  // sweep already retried this row, the update matches nothing and we bail
  // instead of firing a second debit.
  let attemptId;
  if (retryable) {
    const transitioned = await db.from("rental_autopay_attempts").update({
      payment_id: paymentId, status: "created", idempotency_key: key,
      failure_code: null, failure_message: null, updated_at: timestamp,
    }).eq("owner_id", enrollment.owner_id).eq("id", existing.data.id).eq("status", existing.data.status).select();
    if (transitioned.error) throw transitioned.error;
    if (!transitioned.data || transitioned.data.length === 0) {
      // Lost a concurrent race: void the payment row this run just created so
      // the in-flight guard never mistakes it for a live payment. The winning
      // run owns the retry; the next sweep sees a clean state.
      await db.from("rental_payments").update({ status: "cancelled", updated_at: timestamp })
        .eq("owner_id", enrollment.owner_id).eq("id", paymentId);
      return { httpStatus: 409, body: { error: "Autopay attempt changed concurrently; not retried." } };
    }
    attemptId = existing.data.id;
  } else {
    const attempt = await db.from("rental_autopay_attempts").insert({
      owner_id: enrollment.owner_id, id: `rental_autopay_attempt_${crypto.randomUUID()}`, enrollment_id: enrollment.id,
      charge_id: charge.id, payment_id: paymentId, provider_mode: enrollment.provider_mode, status: "created", idempotency_key: key,
    }).select("*").single();
    if (attempt.error) throw attempt.error;
    attemptId = attempt.data.id;
  }

  try {
    const result = await createStripeBillingProvider().createOffSessionPayment(
      { connectedAccountId: account.data.provider_account_id },
      { paymentId, chargeId: charge.id, enrollmentId: enrollment.id, customerId: enrollment.provider_customer_id,
        paymentMethodId: enrollment.provider_payment_method_id, mandateId: enrollment.provider_mandate_id,
        amountCents: totalCents, currencyCode: charge.currency_code },
      key,
    );
    await Promise.all([
      db.from("rental_payments").update({ provider_payment_id: result.paymentIntentId,
        status: result.status === "succeeded" ? "succeeded" : "processing", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", paymentId),
      db.from("rental_autopay_attempts").update({ provider_payment_id: result.paymentIntentId,
        status: result.status === "succeeded" ? "succeeded" : "submitted", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", attemptId),
    ]);
    return { httpStatus: 200, body: { success: true, duplicate: false, retried: retryable, paymentId, status: result.status } };
  } catch (error) {
    const failures = Number(enrollment.consecutive_failures || 0) + 1;
    const pause = failures > Number(enrollment.retry_limit || 0);
    // Record the real provider error instead of a generic message. The
    // failure CODE is the Stripe error TYPE (stable across calls and always
    // present on provider errors) because the retry gate classifies on it:
    // only definitive pre-creation rejections may be auto-retried. The
    // specific code and message stay in the message for diagnosis. Anything
    // without a provider shape fails closed to "autopay_failed" and is never
    // auto-retried.
    const failureCode = error?.type || error?.code || "autopay_failed";
    const failureMessage = String(error?.message || "Automatic payment requires attention.").slice(0, 500);
    // An error that carries a PaymentIntent (e.g. a decline on a confirmed
    // intent) DID reach Stripe — persist its ID so the row can never be
    // mistaken for a never-reached-Stripe failure by a future retry gate.
    const errorPaymentIntentId = error?.payment_intent?.id || error?.paymentIntentId || null;
    await Promise.all([
      db.from("rental_payments").update({ status: "failed", failure_code: failureCode,
        failure_message: failureMessage, provider_payment_id: errorPaymentIntentId,
        updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", paymentId),
      db.from("rental_autopay_attempts").update({ status: "failed", failure_code: failureCode,
        failure_message: failureMessage, provider_payment_id: errorPaymentIntentId,
        updated_at: new Date().toISOString() }).eq("owner_id", enrollment.owner_id).eq("id", attemptId),
      db.from("rental_autopay_enrollments").update({ consecutive_failures: failures, status: pause ? "paused" : "active",
        last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", enrollment.id),
    ]);
    return { httpStatus: 409, body: { error: "Autopay attempt failed.", paused: pause, retried: retryable } };
  }
}
