import { NextResponse } from "next/server";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { finalizeCronRun, startCronRun } from "@/application/rental/cronAudit";

export const runtime = "nodejs";

const JOB_NAME = "settlement-reconciliation";
const ROUTE_PATH = "/api/rental/cron/settlement-reconciliation";

export async function reconcileMissingStripeSettlements(db, provider) {
  const { data: payments, error: paymentError } = await db
    .from("rental_payments")
    .select("id, owner_id, provider_payment_id")
    .eq("provider", "stripe")
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
    .eq("provider", "stripe");
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
  const db = createRentalWebhookClient();
  const run = await startCronRun(db, { jobName: JOB_NAME, routePath: ROUTE_PATH, request });
  try {
    const result = await reconcileMissingStripeSettlements(db, createStripeBillingProvider());
    const summary = { success: true, ...result };
    await finalizeCronRun(db, run, {
      processedCount: result.candidates, succeededCount: result.reconciled,
      pendingCount: result.pending, failedCount: result.failed, summary,
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Rental settlement reconciliation cron error", error);
    await finalizeCronRun(db, run, { status: "failed", failedCount: 1, errorCode: error?.code || null, errorMessage: error?.message });
    return NextResponse.json({ error: "Unable to reconcile rental settlements." }, { status: 500 });
  }
}
