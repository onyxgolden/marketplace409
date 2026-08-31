import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { normalizeStripeConnectEvent } from "@/infrastructure/billing/normalizeStripeConnectEvent";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { isWebhookEventAlreadySettled, webhookLivemodeMatchesServerMode } from "@/application/rental/stripeWebhookLedger";
import { projectStripePayment, projectStripeFeeCredit, projectStripeRefund } from "@/domains/private-financing/stripePaymentProjection";

export const runtime = "nodejs";

async function processPrivateFinancingPaymentEvent(db, provider, normalized) {
  const paymentResult = await db.from("private_financing_online_payments").select("*")
    .eq("provider", "stripe").eq("provider_mode", provider.mode).eq("id", normalized.paymentId).maybeSingle();
  if (paymentResult.error) throw paymentResult.error;
  if (!paymentResult.data) throw new Error("Private financing payment was not found.");
  if (normalized.eventType === "payment_intent.processing") {
    return db.rpc("update_private_financing_stripe_payment_status", { p_payment_id: normalized.paymentId,
      p_provider_mode: provider.mode, p_status: "processing", p_failure_code: null, p_failure_message: null });
  }
  if (normalized.eventType === "payment_intent.payment_failed") {
    return db.rpc("update_private_financing_stripe_payment_status", { p_payment_id: normalized.paymentId,
      p_provider_mode: provider.mode, p_status: "failed", p_failure_code: normalized.failureCode,
      p_failure_message: normalized.failureMessage ? "Stripe reported that the payment failed." : null });
  }
  if (normalized.eventType !== "payment_intent.succeeded") return { data: { ignored: true }, error: null };
  const payment = paymentResult.data;
  const [events, components, terms] = await Promise.all([
    db.from("private_financing_events").select("*").eq("owner_id", payment.owner_id).eq("account_id", payment.account_id).order("ledger_sequence", { ascending: true }),
    db.from("private_financing_components").select("*").eq("owner_id", payment.owner_id).eq("account_id", payment.account_id),
    db.from("private_financing_account_terms_versions").select("*").eq("owner_id", payment.owner_id).eq("account_id", payment.account_id),
  ]);
  if (events.error || components.error || terms.error) throw events.error || components.error || terms.error;
  const projected = projectStripePayment({ eventRows: events.data || [], componentRows: components.data || [],
    termsRows: terms.data || [], payment, effectiveDate: normalized.occurredAt.slice(0, 10) });
  return db.rpc("complete_private_financing_stripe_payment", projected.rpcParams);
}

async function creditPrivateFinancingStripeFee(db, provider, paymentIntentId, feeCents, effectiveDate) {
  if (!Number.isSafeInteger(feeCents) || feeCents <= 0) return null;
  const found = await db.from("private_financing_online_payments").select("*").eq("provider", "stripe")
    .eq("provider_mode", provider.mode).eq("provider_payment_id", paymentIntentId).maybeSingle();
  if (found.error) throw found.error;
  if (!found.data) return null;
  const payment = found.data;
  const [events, components, terms] = await Promise.all([
    db.from("private_financing_events").select("*").eq("owner_id", payment.owner_id).eq("account_id", payment.account_id).order("ledger_sequence", { ascending: true }),
    db.from("private_financing_components").select("*").eq("owner_id", payment.owner_id).eq("account_id", payment.account_id),
    db.from("private_financing_account_terms_versions").select("*").eq("owner_id", payment.owner_id).eq("account_id", payment.account_id),
  ]);
  if (events.error || components.error || terms.error) throw events.error || components.error || terms.error;
  return db.rpc("credit_private_financing_stripe_fee", projectStripeFeeCredit({ eventRows: events.data || [],
    componentRows: components.data || [], termsRows: terms.data || [], payment, feeCents, effectiveDate }));
}

async function processPrivateFinancingRefund(db, provider, normalized) {
  let query=db.from("private_financing_online_payments").select("*").eq("provider","stripe").eq("provider_mode",provider.mode);
  query=normalized.paymentId?.startsWith("pf_payment_")?query.eq("id",normalized.paymentId):query.eq("provider_payment_id",normalized.paymentIntentId);
  const found=await query.maybeSingle();if(found.error)throw found.error;if(!found.data)return null;const payment=found.data;
  if(normalized.refundedAmountCents!==Number(payment.amount_cents))return db.rpc("update_private_financing_stripe_payment_status",{p_payment_id:payment.id,p_provider_mode:provider.mode,p_status:"partially_refunded",p_failure_code:"partial_refund_requires_seller_review",p_failure_message:"A partial Stripe refund requires a seller ledger correction."});
  const [events,components,terms]=await Promise.all([db.from("private_financing_events").select("*").eq("owner_id",payment.owner_id).eq("account_id",payment.account_id).order("ledger_sequence",{ascending:true}),db.from("private_financing_components").select("*").eq("owner_id",payment.owner_id).eq("account_id",payment.account_id),db.from("private_financing_account_terms_versions").select("*").eq("owner_id",payment.owner_id).eq("account_id",payment.account_id)]);if(events.error||components.error||terms.error)throw events.error||components.error||terms.error;
  return db.rpc("reverse_private_financing_stripe_payment",projectStripeRefund({eventRows:events.data||[],componentRows:components.data||[],termsRows:terms.data||[],payment,refundId:normalized.objectId,effectiveDate:normalized.occurredAt.slice(0,10)}));
}

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
  const supabase = createRentalWebhookClient();
  let eventRowId = null;
  try {
    const provider = createStripeBillingProvider();
    const event = verifyStripeWebhookEvent(provider, rawBody, signature, configuredWebhookSecrets());
    const normalized = normalizeStripeConnectEvent(event);
    eventRowId = `stripe_webhook_${normalized.providerEventId}`;

    const modeMatches = webhookLivemodeMatchesServerMode(normalized.livemode, provider.mode);

    const { data: existing, error: lookupExistingError } = await supabase.from("payment_webhook_events")
      .select("status").eq("provider", "stripe").eq("provider_mode", provider.mode).eq("provider_event_id", normalized.providerEventId).maybeSingle();
    if (lookupExistingError) throw lookupExistingError;
    if (existing && isWebhookEventAlreadySettled(existing.status)) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const supported = normalized.supported && modeMatches;
    const { error } = await supabase.from("payment_webhook_events").upsert({
      id: eventRowId,
      provider: "stripe",
      provider_mode: provider.mode,
      provider_event_id: normalized.providerEventId,
      event_type: normalized.eventType,
      object_id: normalized.objectId,
      status: supported ? "received" : "ignored",
      payload_hash: payloadHash,
      processed_at: supported ? null : new Date().toISOString(),
      failure_message: modeMatches ? null : "Event livemode does not match the server's configured Stripe mode.",
    }, { onConflict: "provider,provider_mode,provider_event_id" });
    if (error) throw error;
    if (supported) {
      // Scoped by provider_mode: a live event must only ever find (and mutate) the matching
      // owner's live-mode connected account, never a preserved sandbox row for the same owner.
      const { data: landlordAccount, error: ownerLookupError } = await supabase
        .from("landlord_payment_accounts")
        .select("owner_id")
        .eq("provider", "stripe")
        .eq("provider_mode", provider.mode)
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
      if (normalized.eventType === "refund.updated" && normalized.refundStatus !== "succeeded") {
        // A refund.updated event fires on every status transition, not just completion — a
        // pending or failed refund must never reverse rent. Not an error: acknowledge and ignore.
        const { error: ignoreError } = await supabase.from("payment_webhook_events").update({
          status: "ignored", processed_at: new Date().toISOString(),
        }).eq("id", eventRowId);
        if (ignoreError) throw ignoreError;
        return NextResponse.json({ received: true, ignored: true });
      }
      let refundPaymentId = normalized.paymentId;
      if (normalized.eventType === "refund.updated" && !refundPaymentId && normalized.paymentIntentId) {
        // A refund created outside a FORGE-initiated flow (e.g. directly in the Stripe Dashboard)
        // never carries forge_payment_id metadata — resolve the payment via the PaymentIntent id
        // Stripe always attaches to a refund instead, scoped to this exact owner and mode so a
        // live refund can never resolve to a preserved sandbox payment or another owner's row.
        const { data: matchedPayment, error: matchError } = await supabase.from("rental_payments")
          .select("id").eq("owner_id", landlordAccount.owner_id).eq("provider", "stripe")
          .eq("provider_mode", provider.mode).eq("provider_payment_id", normalized.paymentIntentId).maybeSingle();
        if (matchError) throw matchError;
        refundPaymentId = matchedPayment?.id || null;
      }
      let projection;
      let processedPrivateFinancing = false;
      if (
        (normalized.eventType === "charge.succeeded" || normalized.eventType === "charge.updated")
        && normalized.objectId
      ) {
        const charge = await provider.retrieveCharge(
          { connectedAccountId: normalized.connectedAccountId },
          normalized.objectId,
        );
        const paymentIntentId = normalized.paymentIntentId || charge.paymentIntentId;
        const balanceTransactionId = normalized.balanceTransactionId || charge.balanceTransactionId;
        if (!paymentIntentId || !balanceTransactionId) {
          throw new Error(`Stripe charge ${normalized.objectId} is not ready for settlement reconciliation.`);
        }
        const balance = await provider.retrieveBalanceTransaction(
          { connectedAccountId: normalized.connectedAccountId },
          balanceTransactionId,
        );
        const privateFeeCredit = await creditPrivateFinancingStripeFee(
          supabase, provider, paymentIntentId, balance.feeAmountCents, normalized.occurredAt.slice(0, 10),
        );
        processedPrivateFinancing = Boolean(privateFeeCredit);
        projection = privateFeeCredit || await supabase.rpc("record_stripe_rental_settlement", {
          p_provider_event_id: normalized.providerEventId,
          p_connected_account_id: normalized.connectedAccountId,
          p_payment_intent_id: paymentIntentId,
          p_balance_transaction_id: balance.id,
          p_gross_amount_cents: balance.grossAmountCents,
          p_fee_amount_cents: balance.feeAmountCents,
          p_net_amount_cents: balance.netAmountCents,
          p_currency_code: balance.currencyCode,
          p_status: balance.status,
          p_available_at: balance.availableAt,
          p_provider_mode: provider.mode,
        });
      }
      else if(normalized.eventType==="payout.paid"){const ids=await provider.listPayoutBalanceTransactionIds({connectedAccountId:normalized.connectedAccountId},normalized.objectId);projection=await supabase.rpc("mark_stripe_rental_settlements_paid_out",{p_provider_event_id:normalized.providerEventId,p_connected_account_id:normalized.connectedAccountId,p_payout_id:normalized.objectId,p_balance_transaction_ids:ids,p_paid_out_at:normalized.occurredAt,p_provider_mode:provider.mode});}
      else if(normalized.eventType==="refund.updated"){
        const privateRefund=await processPrivateFinancingRefund(supabase,provider,normalized);
        if(privateRefund){projection=privateRefund;processedPrivateFinancing=true;}
        else projection=await supabase.rpc("process_stripe_rental_refund_event", {
          p_provider_event_id: normalized.providerEventId, p_connected_account_id: normalized.connectedAccountId,
          p_payment_id: refundPaymentId, p_refunded_amount_cents: normalized.refundedAmountCents, p_occurred_at: normalized.occurredAt,
          p_provider_mode: provider.mode,
        });
      }
      else if (normalized.paymentId?.startsWith("pf_payment_") && normalized.eventType.startsWith("payment_intent.")) {
        projection = await processPrivateFinancingPaymentEvent(supabase, provider, normalized);
        processedPrivateFinancing = true;
      }
      else projection = await supabase.rpc("process_stripe_rental_payment_event", {
        p_provider_event_id: normalized.providerEventId,
        p_connected_account_id: normalized.connectedAccountId,
        p_event_type: normalized.eventType,
        p_object_id: normalized.objectId,
        p_payment_id: normalized.paymentId,
        p_failure_code: normalized.failureCode,
        p_failure_message: normalized.failureMessage,
        p_occurred_at: normalized.occurredAt,
        p_provider_mode: provider.mode,
      });
      if (projection.error) throw projection.error;
      if (processedPrivateFinancing) {
        const completed = await supabase.from("payment_webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), failure_message: null }).eq("id", eventRowId);
        if (completed.error) throw completed.error;
      }
      if(normalized.eventType==="payment_intent.succeeded"&&normalized.paymentId&&normalized.paymentMethodId){const activation=await supabase.rpc("activate_rental_autopay_from_payment",{p_connected_account_id:normalized.connectedAccountId,p_payment_id:normalized.paymentId,p_payment_method_id:normalized.paymentMethodId,p_mandate_id:normalized.mandateId,p_provider_mode:provider.mode});if(activation.error)throw activation.error;}
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    // Never log a raw Stripe/Postgres error message — it can carry object ids, URLs, or other
    // request detail. Only a coarse error classification is recorded.
    console.error("Stripe Connect webhook rejected", { name: error?.name || "Error", eventRowId });
    if (eventRowId) {
      await supabase.from("payment_webhook_events").update({
        status: "failed", failure_message: "Processing failed.",
      }).eq("id", eventRowId).then(() => {}, () => {});
    }
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
}
