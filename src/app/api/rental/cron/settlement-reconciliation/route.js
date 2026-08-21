import { NextResponse } from "next/server";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";

export const runtime = "nodejs";

export async function reconcileMissingStripeSettlements(db, provider) {
  // Scoped to the server's configured provider_mode: a live-mode cron run must never surface a
  // preserved sandbox payment as a reconciliation candidate, and vice versa.
  const { data: payments, error: paymentError } = await db
    .from("rental_payments")
    .select("id, owner_id, provider_payment_id")
    .eq("provider", "stripe")
    .eq("provider_mode", provider.mode)
    .eq("status", "succeeded")
    .not("provider_payment_id", "is", null)
    .limit(100);
  if (paymentError) throw paymentError;

  const paymentIds = (payments || []).map((payment) => payment.id);
  const { data: settlements, error: settlementError } = paymentIds.length
    ? await db.from("rental_settlements").select("payment_id").in("payment_id", paymentIds)
    : { data: [], error: null };
  if (settlementError) throw settlementError;

  const { data: accounts, error: accountError } = await db
    .from("landlord_payment_accounts")
    .select("owner_id, provider_account_id")
    .eq("provider", "stripe")
    .eq("provider_mode", provider.mode);
  if (accountError) throw accountError;

  const settledPaymentIds = new Set((settlements || []).map((row) => row.payment_id));
  const accountByOwner = new Map((accounts || []).map((row) => [row.owner_id, row.provider_account_id]));
  const candidates = (payments || []).filter((payment) => !settledPaymentIds.has(payment.id));

  let reconciled = 0;
  let pending = 0;
  let failed = 0;

  for (const payment of candidates) {
    const connectedAccountId = accountByOwner.get(payment.owner_id);
    if (!connectedAccountId) {
      failed += 1;
      continue;
    }

    try {
      const settlement = await provider.retrievePaymentIntentSettlement(
        { connectedAccountId },
        payment.provider_payment_id,
      );
      if (!settlement.balanceTransactionId) {
        pending += 1;
        continue;
      }

      const balance = await provider.retrieveBalanceTransaction(
        { connectedAccountId },
        settlement.balanceTransactionId,
      );
      const result = await db.rpc("record_stripe_rental_settlement", {
        p_provider_event_id: `settlement_reconciliation_${settlement.paymentIntentId}_${balance.id}`,
        p_connected_account_id: connectedAccountId,
        p_payment_intent_id: settlement.paymentIntentId,
        p_balance_transaction_id: balance.id,
        p_gross_amount_cents: balance.grossAmountCents,
        p_fee_amount_cents: balance.feeAmountCents,
        p_net_amount_cents: balance.netAmountCents,
        p_currency_code: balance.currencyCode,
        p_status: balance.status,
        p_available_at: balance.availableAt,
        p_provider_mode: provider.mode,
      });
      if (result.error) throw result.error;
      reconciled += 1;
    } catch (error) {
      failed += 1;
      console.error("Rental settlement reconciliation failed", { paymentId: payment.id }, error);
    }
  }

  return { candidates: candidates.length, reconciled, pending, failed };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await reconcileMissingStripeSettlements(
      createRentalWebhookClient(),
      createStripeBillingProvider(),
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Rental settlement reconciliation cron error", error);
    return NextResponse.json({ error: "Unable to reconcile rental settlements." }, { status: 500 });
  }
}
