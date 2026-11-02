// Signed Stripe webhook delivery for the smoke suite.
//
// The suite never depends on Stripe's delivery infrastructure reaching an
// ephemeral preview deployment (webhook delivery timing is out of scope,
// scope §4.1). Instead, after the browser confirms a test-mode PaymentIntent,
// the suite delivers a properly SIGNED payment_intent.succeeded event built
// from that real PaymentIntent object to the app's webhook route. The route
// verifies the signature against its configured secret exactly as it would
// for a Stripe delivery, so the handler path exercised is the real one —
// only the transport is simulated, and that substitution is stated here,
// not hidden.
//
// Requires: E2E_STRIPE_WEBHOOK_SECRET equals the target's
// STRIPE_CONNECT_WEBHOOK_SECRET (or STRIPE_WEBHOOK_SECRET_PLATFORM).
import Stripe from "stripe";

export async function deliverSucceededEvent({
  baseUrl, stripeSecret, webhookSecret, connectedAccountId, paymentIntentId, runId, n,
}) {
  const stripe = new Stripe(stripeSecret);
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: connectedAccountId });
  if (intent.status !== "succeeded") {
    throw new Error(`Cannot deliver webhook: PaymentIntent ${paymentIntentId} status is ${intent.status}, not succeeded.`);
  }
  const event = {
    id: `evt_e2e_${runId}_${n}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.succeeded",
    livemode: false,
    account: connectedAccountId,
    data: { object: intent },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const response = await fetch(`${baseUrl}/api/rental/stripe-webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Webhook delivery failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function retrievePaymentIntent(stripeSecret, connectedAccountId, paymentIntentId) {
  const stripe = new Stripe(stripeSecret);
  return stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: connectedAccountId });
}
