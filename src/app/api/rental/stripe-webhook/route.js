import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { normalizeStripeConnectEvent } from "@/infrastructure/billing/normalizeStripeConnectEvent";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";

export const runtime = "nodejs";

function configuredWebhookSecrets(env = process.env) {
  return [env.STRIPE_CONNECT_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET_PLATFORM]
    .filter((secret) => typeof secret === "string" && secret.trim() !== "");
}

function verifyStripeWebhookEvent(provider, rawBody, signature, secrets) {
  if (secrets.length === 0) throw new Error("No Stripe webhook secret is configured.");
  let lastError;
  for (const secret of secrets) {
    try {
      return provider.constructWebhookEvent(rawBody, signature, secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  try {
    const provider = createStripeBillingProvider();
    const event = verifyStripeWebhookEvent(provider, rawBody, signature, configuredWebhookSecrets());
    const normalized = normalizeStripeConnectEvent(event);
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const supabase = createRentalWebhookClient();
    const eventRowId = `stripe_webhook_${normalized.providerEventId}`;
    const { error } = await supabase.from("payment_webhook_events").upsert({
      id: eventRowId,
      provider: "stripe",
      provider_event_id: normalized.providerEventId,
      event_type: normalized.eventType,
      object_id: normalized.objectId,
      status: normalized.supported ? "received" : "ignored",
      payload_hash: payloadHash,
      processed_at: normalized.supported ? null : new Date().toISOString(),
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
    if (error) throw error;
    if (normalized.supported) {
      const { data: landlordAccount, error: ownerLookupError } = await supabase
        .from("landlord_payment_accounts")
        .select("owner_id")
        .eq("provider", "stripe")
        .eq("provider_account_id", normalized.connectedAccountId)
        .maybeSingle();
      if (ownerLookupError) throw ownerLookupError;
      if (!landlordAccount) {
        const { error: ignoreError } = await supabase.from("payment_webhook_events").update({
          status: "ignored",
          processed_at: new Date().toISOString(),
          failure_message: `Unknown Stripe connected account: ${normalized.connectedAccountId}.`,
        }).eq("id", eventRowId);
        if (ignoreError) throw ignoreError;
        return NextResponse.json({ received: true, ignored: true });
      }
      let projection;
      if(normalized.eventType==="charge.succeeded"&&normalized.paymentIntentId&&normalized.balanceTransactionId){const balance=await provider.retrieveBalanceTransaction({connectedAccountId:normalized.connectedAccountId},normalized.balanceTransactionId);projection=await supabase.rpc("record_stripe_rental_settlement",{p_provider_event_id:normalized.providerEventId,p_connected_account_id:normalized.connectedAccountId,p_payment_intent_id:normalized.paymentIntentId,p_balance_transaction_id:balance.id,p_gross_amount_cents:balance.grossAmountCents,p_fee_amount_cents:balance.feeAmountCents,p_net_amount_cents:balance.netAmountCents,p_currency_code:balance.currencyCode,p_status:balance.status,p_available_at:balance.availableAt});}
      else if(normalized.eventType==="payout.paid"){const ids=await provider.listPayoutBalanceTransactionIds({connectedAccountId:normalized.connectedAccountId},normalized.objectId);projection=await supabase.rpc("mark_stripe_rental_settlements_paid_out",{p_provider_event_id:normalized.providerEventId,p_connected_account_id:normalized.connectedAccountId,p_payout_id:normalized.objectId,p_balance_transaction_ids:ids,p_paid_out_at:normalized.occurredAt});}
      else projection = normalized.eventType === "refund.updated" ? await supabase.rpc("process_stripe_rental_refund_event", {
        p_provider_event_id: normalized.providerEventId, p_connected_account_id: normalized.connectedAccountId,
        p_payment_id: normalized.paymentId, p_refunded_amount_cents: normalized.refundedAmountCents, p_occurred_at: normalized.occurredAt,
      }) : await supabase.rpc("process_stripe_rental_payment_event", {
        p_provider_event_id: normalized.providerEventId,
        p_connected_account_id: normalized.connectedAccountId,
        p_event_type: normalized.eventType,
        p_object_id: normalized.objectId,
        p_payment_id: normalized.paymentId,
        p_failure_code: normalized.failureCode,
        p_failure_message: normalized.failureMessage,
        p_occurred_at: normalized.occurredAt,
      });
      if (projection.error) throw projection.error;
      if(normalized.eventType==="payment_intent.succeeded"&&normalized.paymentId&&normalized.paymentMethodId){const activation=await supabase.rpc("activate_rental_autopay_from_payment",{p_connected_account_id:normalized.connectedAccountId,p_payment_id:normalized.paymentId,p_payment_method_id:normalized.paymentMethodId,p_mandate_id:normalized.mandateId});if(activation.error)throw activation.error;}
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe Connect webhook rejected", error);
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
}
