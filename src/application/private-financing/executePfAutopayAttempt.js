import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";

// Private-financing counterpart of application/rental/executeAutopayAttempt.js.
// Extracted so both the manual /api/private-financing/autopay/execute endpoint and the
// autopay-sweep cron attempt a single (enrollment, billingPeriod) pair identically.
//
// Unlike rent (which has rent_charges rows), a financing account has no charge ledger:
// each attempt debits the account's current regular scheduled payment amount, once per
// billing month. (owner_id, enrollment_id, billing_period) uniqueness on
// private_financing_autopay_attempts makes re-runs and double invocations no-ops.
//
// The inserted private_financing_online_payments row flows through the EXISTING Stripe
// webhook settlement path (matched by provider_payment_id), so ACH debits settle and
// post to the ledger exactly like borrower-initiated bank payments do.

export function currentBillingPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function executePfAutopayAttempt(db, enrollmentId, billingPeriod) {
  if (!enrollmentId || !billingPeriod) return { httpStatus: 400, body: { error: "Enrollment and billing period are required." } };
  if (!/^[0-9]{4}-[0-9]{2}$/.test(billingPeriod)) return { httpStatus: 400, body: { error: "Billing period must be YYYY-MM." } };

  const { data: enrollment, error: enrollmentError } = await db.from("private_financing_autopay_enrollments")
    .select("*").eq("id", enrollmentId).eq("status", "active").single();
  if (enrollmentError || !enrollment)
    return { httpStatus: 409, body: { error: "An active autopay enrollment is required." } };
  if (enrollment.payment_method_type !== "us_bank_account" || !enrollment.provider_payment_method_id)
    return { httpStatus: 409, body: { error: "This enrollment has no verified bank payment method." } };

  const existing = await db.from("private_financing_autopay_attempts").select("*")
    .eq("owner_id", enrollment.owner_id).eq("enrollment_id", enrollment.id).eq("billing_period", billingPeriod).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { httpStatus: 200, body: { success: true, duplicate: true, attempt: existing.data } };

  // Eligibility gates for this attempt: active account, online payments enabled for the
  // account, a positive regular scheduled amount, no other payment already pending for
  // this (account, borrower), and a ready landlord Stripe account scoped to the
  // *enrollment's own* provider_mode — a sandbox bank payment method must never be
  // charged against a live connected account, or vice versa.
  const [accountResult, settingsResult, termsResult, pendingResult] = await Promise.all([
    db.from("private_financing_accounts").select("id,status").eq("owner_id", enrollment.owner_id).eq("id", enrollment.account_id).maybeSingle(),
    db.from("private_financing_online_payment_settings").select("enabled").eq("owner_id", enrollment.owner_id).eq("account_id", enrollment.account_id).maybeSingle(),
    db.from("private_financing_current_account_terms").select("regular_scheduled_payment_amount_cents").eq("owner_id", enrollment.owner_id).eq("account_id", enrollment.account_id).maybeSingle(),
    db.from("private_financing_online_payments").select("id").eq("owner_id", enrollment.owner_id).eq("account_id", enrollment.account_id).eq("borrower_id", enrollment.borrower_id)
      .in("status", ["created", "requires_payment_method", "requires_action", "processing"]).maybeSingle(),
  ]);
  if (accountResult.error) throw accountResult.error;
  if (settingsResult.error) throw settingsResult.error;
  if (termsResult.error) throw termsResult.error;
  if (pendingResult.error) throw pendingResult.error;
  if (accountResult.data?.status !== "active")
    return { httpStatus: 409, body: { error: "This financing account is not active." } };
  if (!settingsResult.data?.enabled)
    return { httpStatus: 409, body: { error: "Online payments are not active for this financing account." } };
  const amountCents = Number(termsResult.data?.regular_scheduled_payment_amount_cents || 0);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
    return { httpStatus: 409, body: { error: "This account has no scheduled payment amount to debit." } };
  if (pendingResult.data)
    return { httpStatus: 409, body: { error: "A payment is already pending for this account." } };

  const account = await db.from("landlord_payment_accounts").select("*")
    .eq("owner_id", enrollment.owner_id).eq("provider", "stripe").eq("provider_mode", enrollment.provider_mode).single();
  if (account.error || !account.data?.provider_account_id) throw account.error || new Error("Stripe account missing");
  if (account.data.status !== "enabled" || !account.data.charges_enabled || !account.data.payouts_enabled)
    return { httpStatus: 409, body: { error: "The seller payment account is not ready." } };

  const paymentId = `pf_payment_${crypto.randomUUID()}`;
  const key = `pf-autopay:${enrollment.id}:${billingPeriod}`;
  const timestamp = new Date().toISOString();

  const payment = await db.from("private_financing_online_payments").insert({
    owner_id: enrollment.owner_id, id: paymentId, account_id: enrollment.account_id, borrower_id: enrollment.borrower_id,
    provider: "stripe", provider_mode: enrollment.provider_mode, provider_customer_id: enrollment.provider_customer_id,
    amount_cents: amountCents, currency_code: "USD", status: "created", idempotency_key: key,
    created_at: timestamp, updated_at: timestamp,
  }).select("*").single();
  if (payment.error) throw payment.error;

  const attempt = await db.from("private_financing_autopay_attempts").insert({
    owner_id: enrollment.owner_id, id: `pf_autopay_attempt_${crypto.randomUUID()}`, enrollment_id: enrollment.id,
    billing_period: billingPeriod, payment_id: paymentId, provider_mode: enrollment.provider_mode, status: "created",
    idempotency_key: key, created_at: timestamp, updated_at: timestamp,
  }).select("*").single();
  if (attempt.error) throw attempt.error;

  try {
    const result = await createStripeBillingProvider().createOffSessionPayment(
      { connectedAccountId: account.data.provider_account_id },
      { paymentId, chargeId: billingPeriod, enrollmentId: enrollment.id, customerId: enrollment.provider_customer_id,
        paymentMethodId: enrollment.provider_payment_method_id, amountCents, currencyCode: "USD" },
      key,
    );
    await Promise.all([
      db.from("private_financing_online_payments").update({ provider_payment_id: result.paymentIntentId,
        status: result.status === "succeeded" ? "succeeded" : "processing", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", paymentId),
      db.from("private_financing_autopay_attempts").update({ provider_payment_id: result.paymentIntentId,
        status: result.status === "succeeded" ? "succeeded" : "submitted", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", attempt.data.id),
      db.from("private_financing_autopay_enrollments").update({ consecutive_failures: 0, last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString() }).eq("owner_id", enrollment.owner_id).eq("id", enrollment.id),
    ]);
    return { httpStatus: 200, body: { success: true, duplicate: false, paymentId, billingPeriod, status: result.status } };
  } catch (error) {
    const failures = Number(enrollment.consecutive_failures || 0) + 1;
    const pause = failures > Number(enrollment.retry_limit || 0);
    await Promise.all([
      db.from("private_financing_online_payments").update({ status: "failed", failure_code: "autopay_failed",
        failure_message: "Automatic payment requires attention.", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", paymentId),
      db.from("private_financing_autopay_attempts").update({ status: "failed",
        failure_message: "Automatic payment requires attention.", updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", attempt.data.id),
      db.from("private_financing_autopay_enrollments").update({ consecutive_failures: failures, status: pause ? "paused" : "active",
        last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("owner_id", enrollment.owner_id).eq("id", enrollment.id),
    ]);
    return { httpStatus: 409, body: { error: "Autopay attempt failed.", paused: pause } };
  }
}
