import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { normalizeStripeConnectEvent } from "@/infrastructure/billing/normalizeStripeConnectEvent";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";

export const runtime = "nodejs";

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  try {
    const provider = createStripeBillingProvider();
    const event = provider.constructWebhookEvent(rawBody, signature, process.env.STRIPE_CONNECT_WEBHOOK_SECRET);
    const normalized = normalizeStripeConnectEvent(event);
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const supabase = createRentalWebhookClient();
    const { error } = await supabase.from("payment_webhook_events").upsert({
      id: `stripe_webhook_${normalized.providerEventId}`,
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
      const projection = await supabase.rpc("process_stripe_rental_payment_event", {
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
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe Connect webhook rejected", error);
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
}
