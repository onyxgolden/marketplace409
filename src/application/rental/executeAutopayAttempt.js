import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";

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

  const existing = await db.from("rental_autopay_attempts").select("*")
    .eq("owner_id", enrollment.owner_id).eq("enrollment_id", enrollment.id).eq("charge_id", charge.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { httpStatus: 200, body: { success: true, duplicate: true, attempt: existing.data } };

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
  const billingSettings = await db.from("rental_billing_settings").select("billing_enabled")
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

  const remaining = Number(charge.amount_cents) - Number(charge.paid_amount_cents);
  const paymentId = `rental_payment_${crypto.randomUUID()}`;
  const key = `autopay:${enrollment.id}:${charge.id}`;
  const timestamp = new Date().toISOString();

  const payment = await db.from("rental_payments").insert({
    owner_id: enrollment.owner_id, id: paymentId, charge_id: charge.id, lease_id: charge.lease_id, tenant_id: enrollment.tenant_id,
    provider: "stripe", provider_mode: enrollment.provider_mode, provider_customer_id: enrollment.provider_customer_id, amount_cents: remaining, refunded_amount_cents: 0,
    currency_code: charge.currency_code, status: "created", idempotency_key: key, created_at: timestamp, updated_at: timestamp,
  }).select("*").single();
  if (payment.error) throw payment.error;

  const attempt = await db.from("rental_autopay_attempts").insert({
    owner_id: enrollment.owner_id, id: `rental_autopay_attempt_${crypto.randomUUID()}`, enrollment_id: enrollment.id,
    charge_id: charge.id, payment_id: paymentId, provider_mode: enrollment.provider_mode, status: "created", idempotency_key: key,
  }).select("*").single();
  if (attempt.error) throw attempt.error;

  try {
    const result = await createStripeBillingProvider().createOffSessionPayment(
      { connectedAccountId: account.data.provider_account_id },
      { paymentId, chargeId: charge.id, enrollmentId: enrollment.id, customerId: enrollment.provider_customer_id,
        paymentMethodId: enrollment.provider_payment_method_id, amountCents: remaining, currencyCode: charge.currency_code },
      key,
    );
    await Promise.all([
      db.from("rental_payments").update({ provider_payment_id: result.paymentIntentId,
        status: result.status === "succeeded" ? "succeeded" : "processing", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", paymentId),
      db.from("rental_autopay_attempts").update({ provider_payment_id: result.paymentIntentId,
        status: result.status === "succeeded" ? "succeeded" : "submitted", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", attempt.data.id),
    ]);
    return { httpStatus: 200, body: { success: true, duplicate: false, paymentId, status: result.status } };
  } catch (error) {
    const failures = Number(enrollment.consecutive_failures || 0) + 1;
    const pause = failures > Number(enrollment.retry_limit || 0);
    await Promise.all([
      db.from("rental_payments").update({ status: "failed", failure_code: "autopay_failed",
        failure_message: "Automatic payment requires attention.", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", paymentId),
      db.from("rental_autopay_attempts").update({ status: "failed", failure_message: "Automatic payment requires attention.",
        updated_at: new Date().toISOString() }).eq("owner_id", enrollment.owner_id).eq("id", attempt.data.id),
      db.from("rental_autopay_enrollments").update({ consecutive_failures: failures, status: pause ? "paused" : "active",
        last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", enrollment.id),
    ]);
    return { httpStatus: 409, body: { error: "Autopay attempt failed.", paused: pause } };
  }
}
