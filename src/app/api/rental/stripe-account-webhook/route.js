import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { buildLandlordPaymentAccountUpdate } from "@/application/rental/landlordPaymentAccountStatus";
import { isWebhookEventAlreadySettled, webhookLivemodeMatchesServerMode } from "@/application/rental/stripeWebhookLedger";

export const runtime = "nodejs";

// Dedicated endpoint for V2 account thin events — kept separate from the payment webhook
// (STRIPE_CONNECT_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET_PLATFORM) so a compromised or
// misconfigured account-event source can never be used to forge payment-event signatures, and
// vice versa. Exact event-type strings verified from the installed stripe-node 22.5.0 type
// definitions (resources/V2/Core/Events.d.ts), not guessed.
const SUPPORTED_NOTIFICATION_TYPES = new Set([
  "v2.core.account[requirements].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
]);

function accountWebhookSecret(env = process.env) {
  const secret = env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET;
  return typeof secret === "string" && secret.trim() !== "" ? secret : null;
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  const secret = accountWebhookSecret();
  if (!secret) return NextResponse.json({ error: "Account webhook is not configured." }, { status: 500 });

  const supabase = createRentalWebhookClient();
  let eventRowId = null;
  try {
    const provider = createStripeBillingProvider();
    // Verifies the signature and retrieves the full V2 event before any state is applied.
    const notification = await provider.parseAccountWebhookNotification(rawBody, signature, secret);
    const supported = SUPPORTED_NOTIFICATION_TYPES.has(notification.type);
    const accountId = notification.related_object?.id || null;
    eventRowId = `stripe_account_webhook_${notification.id}`;

    // A mode mismatch fails closed before the ledger is even touched for a *new* event — the
    // server never records having "handled" an event it refused to trust.
    const modeMatches = webhookLivemodeMatchesServerMode(notification.livemode, provider.mode);

    const { data: existing, error: lookupExistingError } = await supabase.from("payment_webhook_events")
      .select("status").eq("provider", "stripe").eq("provider_event_id", notification.id).maybeSingle();
    if (lookupExistingError) throw lookupExistingError;
    if (existing && isWebhookEventAlreadySettled(existing.status)) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const outcomeStatus = !modeMatches || !supported ? "ignored" : "received";
    const { error: recordError } = await supabase.from("payment_webhook_events").upsert({
      id: eventRowId,
      provider: "stripe",
      provider_mode: provider.mode,
      provider_event_id: notification.id,
      event_type: notification.type,
      object_id: accountId,
      status: outcomeStatus,
      payload_hash: payloadHash,
      processed_at: outcomeStatus === "ignored" ? new Date().toISOString() : null,
      failure_message: modeMatches ? null : "Event livemode does not match the server's configured Stripe mode.",
    }, { onConflict: "provider,provider_event_id" });
    if (recordError) throw recordError;

    if (!modeMatches || !supported || !accountId) return NextResponse.json({ received: true, ignored: true });

    // Scoped strictly to the matching owner's landlord_payment_accounts row for this exact mode —
    // this handler never touches rental_payments, rental_settlements, or any payment/charge/
    // refund/payout RPC.
    const { data: landlordAccount, error: lookupError } = await supabase
      .from("landlord_payment_accounts")
      .select("owner_id")
      .eq("provider", "stripe")
      .eq("provider_mode", provider.mode)
      .eq("provider_account_id", accountId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!landlordAccount) {
      const { error: ignoreError } = await supabase.from("payment_webhook_events").update({
        status: "ignored",
        processed_at: new Date().toISOString(),
        failure_message: `Unknown Stripe connected account: ${accountId}.`,
      }).eq("id", eventRowId);
      if (ignoreError) throw ignoreError;
      return NextResponse.json({ received: true, ignored: true });
    }

    const current = await provider.retrieveAccountStatus({ ownerId: landlordAccount.owner_id, connectedAccountId: accountId });
    const { error: updateError } = await supabase.from("landlord_payment_accounts")
      .update(buildLandlordPaymentAccountUpdate(current))
      .eq("owner_id", landlordAccount.owner_id).eq("provider", "stripe").eq("provider_mode", provider.mode);
    if (updateError) throw updateError;

    const { error: processedError } = await supabase.from("payment_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", eventRowId);
    if (processedError) throw processedError;

    return NextResponse.json({ received: true });
  } catch (error) {
    // Never log a raw Stripe/Postgres error message — it can carry object ids, URLs, or other
    // request detail. Only a coarse error classification is recorded.
    console.error("Stripe account webhook rejected", { name: error?.name || "Error", eventRowId });
    if (eventRowId) {
      await supabase.from("payment_webhook_events").update({
        status: "failed", failure_message: "Processing failed.",
      }).eq("id", eventRowId).then(() => {}, () => {});
    }
    return NextResponse.json({ error: "Invalid Stripe account webhook." }, { status: 400 });
  }
}
