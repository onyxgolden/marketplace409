import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { ReservationFinanceProvider } from "@/infrastructure/billing/ReservationFinanceProvider";
import { normalizeReservationFinanceEvent, reservationProviderId } from "@/infrastructure/billing/normalizeReservationFinanceEvent";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";

export const runtime = "nodejs";

async function resolve(db, account, paymentIntentId = null) {
  const result = await db.rpc("resolve_reservation_finance_attempts", {
    p_connected_account_id: account, p_payment_intent_id: paymentIntentId,
  });
  if (result.error || !Array.isArray(result.data)) throw new Error("Reservation identity lookup failed.");
  return result.data;
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  let signed;
  let provider;
  try {
    provider = createStripeBillingProvider();
    // Dedicated test-mode subscription keeps reservation reconciliation out of lease routing.
    const secret = process.env.STRIPE_RESERVATION_FINANCE_WEBHOOK_SECRET;
    if (!secret) throw new Error("Missing webhook configuration.");
    signed = provider.constructWebhookEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
  if (!reservationProviderId(signed?.id) || !signed.id.startsWith("evt_")) {
    return NextResponse.json({ error: "Invalid provider event identity." }, { status: 400 });
  }
  const db = createRentalWebhookClient();
  const args = {
    p_provider_event_id: signed.id,
    p_connected_account_id: reservationProviderId(signed.account),
    p_provider_mode: signed.livemode === false ? "test" : "unknown",
    p_event_type: typeof signed.type === "string" ? signed.type.slice(0, 100) : "unknown",
    p_provider_object_id: reservationProviderId(signed.data?.object?.id),
    p_payload_hash: createHash("sha256").update(rawBody).digest("hex"),
    p_occurred_at: null, p_observations: [], p_unknown_reason: null,
  };
  try {
    const event = normalizeReservationFinanceEvent(signed);
    if (provider.mode !== "test") throw new Error("Server mode mismatch.");
    args.p_occurred_at = event.occurredAt;
    const candidates = await resolve(db, event.connectedAccountId);
    if (candidates.length === 0) throw new Error("Unknown account or payment.");
    const adapter = new ReservationFinanceProvider(provider, event.connectedAccountId);
    const find = paymentIntentId => {
      const matched = candidates.filter(value => value.paymentIntentId === paymentIntentId);
      if (matched.length !== 1) throw new Error("Unknown payment intent.");
      return matched[0];
    };
    if (event.eventType === "balance.available") {
      for (const attempt of candidates.filter(value => value.paymentStatus === "succeeded")) {
        args.p_observations.push(...await adapter.observations(attempt));
      }
    } else if (event.eventType.startsWith("payout.")) {
      const payout = await adapter.payout(event.objectId);
      for (const chargeId of payout.chargeIds) {
        const attempt = find(await adapter.paymentIntentForCharge(chargeId));
        args.p_observations.push(...await adapter.observations(attempt, { payout, expectedChargeId: chargeId }));
      }
    } else {
      const paymentIntentId = event.paymentIntentId
        || (event.chargeId ? await adapter.paymentIntentForCharge(event.chargeId) : null);
      const attempt = find(paymentIntentId);
      args.p_observations = await adapter.observations(attempt, {
        refunds: event.eventType.startsWith("refund.") || event.eventType === "charge.refunded",
        disputeId: event.eventType.startsWith("charge.dispute.") ? event.objectId : null,
        ...(event.chargeId ? { expectedChargeId: event.chargeId } : {}),
      });
      // The triggering provider object itself must occur in the verified object graph.
      if (event.eventType.startsWith("refund.") && !args.p_observations.some(value => value.objectId === event.objectId)) {
        throw new Error("Unknown refund.");
      }
    }
  } catch {
    args.p_observations = [];
    args.p_unknown_reason = "unverified_provider_evidence";
  }
  try {
    const result = await db.rpc("record_reservation_finance_event", args);
    if (result.error) throw new Error("Finance evidence persistence failed.");
    return NextResponse.json({ received: true, ...result.data });
  } catch {
    return NextResponse.json({ error: "Unable to retain reservation finance evidence." }, { status: 500 });
  }
}
