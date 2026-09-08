import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { createFinancialConnectionsWebhookClient } from "@/lib/supabase/createFinancialConnectionsWebhookClient";
import { createConnectionPlatformSuite, ConnectionRepositoryStorage, CredentialReferenceRepositoryStorage, InstitutionReferenceRepositoryStorage, FinancialAccountRepositoryStorage } from "@/infrastructure/composition";
import { parseVaultedState, serializeVaultedState } from "@/domains/stripe-financial-connections-adapter";

export const runtime = "nodejs";

// AccountBalanceRepositoryStorage/FinancialEventRepositoryStorage/ConnectionExecutionHistoryRepositoryStorage
// are not re-exported from the top-level composition index (only createConnectionPlatformSuite.js
// itself imports them directly, from their own sibling files) -- their value is simply the
// literal string "supabase" in every one of those enums, used inline below instead of importing
// three more one-off paths for the same constant.
const SUPABASE_STORAGE = "supabase";

// Financial Connections events arrive on their OWN dashboard-configured webhook endpoint/secret --
// distinct from the Rental Stripe Connect webhook (payment_intent/charge/payout/refund events,
// STRIPE_CONNECT_WEBHOOK_SECRET/STRIPE_WEBHOOK_SECRET_PLATFORM), which this route never touches.
// Reuses the SAME verification mechanism (StripeBillingProvider.constructWebhookEvent, the one
// configured Stripe SDK instance) and the same received/processed/ignored/failed idempotency
// pattern as that webhook's own payment_webhook_events table -- just against a provider-neutral
// table (connection_webhook_events) scoped to this bounded context instead.
//
// Uses Stripe's webhook events as the PRIMARY ongoing-update mechanism (per the approved design):
// the manual "Execute" sync button remains available for a user-requested refresh, but ongoing
// updates are driven by this route, not a polling cron.
function configuredWebhookSecret(env = process.env) {
  const secret = env.STRIPE_FINANCIAL_CONNECTIONS_WEBHOOK_SECRET;
  if (typeof secret !== "string" || secret.trim() === "") {
    throw new Error("STRIPE_FINANCIAL_CONNECTIONS_WEBHOOK_SECRET is not configured.");
  }
  return secret;
}

// Resolves which FORGE connection/owner a Stripe Financial Connections account id belongs to.
// Relies on a financial_accounts row already existing for it -- true from the moment a session
// completes (the /complete route runs a best-effort initial import immediately after persisting
// the connection, specifically so this lookup always has something to find by the time any
// refresh webhook could plausibly arrive for a subscribed account).
async function resolveOwningConnection(supabase, stripeAccountId) {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("owner_id, connection_id")
    .eq("provider", "stripe_financial_connections")
    .eq("provider_account_id", stripeAccountId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ownerId: data.owner_id, connectionId: data.connection_id } : null;
}

async function markEvent(supabase, eventRowId, fields) {
  const { error } = await supabase.from("connection_webhook_events").update(fields).eq("id", eventRowId);
  if (error) throw error;
}

// Advances the per-account transaction-refresh cursor ONLY after coordinator.executeImport()
// above has already returned success -- never before, never on a throw. A redelivered event for
// the same provider_event_id is caught earlier by the connection_webhook_events idempotency check
// and never reaches this again; a genuinely new refresh that fails leaves the cursor untouched, so
// the next attempt (webhook retry or manual sync) safely re-fetches from the same watermark.
async function advanceTransactionRefreshCursor(supabase, credentialVaultService, { ownerId, vaultReference, accountId, refreshId }) {
  const secret = await credentialVaultService.retrieveCredential(ownerId, vaultReference);
  if (!secret) return;
  const vaultedState = parseVaultedState(secret);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nextState = {
    ...vaultedState,
    transactionRefreshCursors: {
      ...vaultedState.transactionRefreshCursors,
      [accountId]: { lastProcessedTransactionRefreshId: refreshId, lastProcessedTransactedAt: nowSeconds },
    },
  };
  await credentialVaultService.storeCredential({ ownerId, vaultReference, secret: serializeVaultedState(nextState) });
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  const supabase = createFinancialConnectionsWebhookClient();
  let eventRowId = null;

  try {
    const stripeBillingProvider = createStripeBillingProvider();
    const secret = configuredWebhookSecret();
    const event = stripeBillingProvider.constructWebhookEvent(rawBody, signature, secret);
    eventRowId = `connection_webhook_stripe_financial_connections_${event.id}`;

    const { data: existing, error: lookupError } = await supabase
      .from("connection_webhook_events")
      .select("status")
      .eq("provider", "stripe_financial_connections")
      .eq("provider_event_id", event.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && (existing.status === "processed" || existing.status === "ignored")) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const supportedEvents = new Set([
      "financial_connections.account.refreshed_balance",
      "financial_connections.account.refreshed_transactions",
      "financial_connections.account.disconnected",
      "financial_connections.account.reactivated",
    ]);
    const supported = supportedEvents.has(event.type);

    const { error: upsertError } = await supabase.from("connection_webhook_events").upsert({
      id: eventRowId,
      provider: "stripe_financial_connections",
      provider_event_id: event.id,
      event_type: event.type,
      object_id: event.data?.object?.id ?? null,
      status: supported ? "received" : "ignored",
      payload_hash: payloadHash,
      processed_at: supported ? null : new Date().toISOString(),
    }, { onConflict: "provider,provider_event_id" });
    if (upsertError) throw upsertError;

    if (!supported) {
      return NextResponse.json({ received: true, ignored: true });
    }

    const account = event.data.object;
    const owning = await resolveOwningConnection(supabase, account.id);
    if (!owning) {
      await markEvent(supabase, eventRowId, { status: "ignored", processed_at: new Date().toISOString(), failure_message: "No FORGE connection found for this Stripe account." });
      return NextResponse.json({ received: true, ignored: true });
    }

    // refreshed_balance / refreshed_transactions: check the refresh's own status BEFORE doing any
    // further work -- a webhook fires on every attempt, not just success, and refreshes are
    // asynchronous. A failed/pending refresh, or an inactive account, is acknowledged and
    // ignored, never treated as fresh data or refreshed/imported -- checked here, before
    // constructing the platform suite at all, not just before acting on it.
    if (event.type === "financial_connections.account.refreshed_balance" || event.type === "financial_connections.account.refreshed_transactions") {
      const refreshField = event.type === "financial_connections.account.refreshed_balance" ? account.balance_refresh : account.transaction_refresh;
      if (refreshField?.status !== "succeeded") {
        await markEvent(supabase, eventRowId, { status: "ignored", processed_at: new Date().toISOString() });
        return NextResponse.json({ received: true, ignored: true });
      }
      if (account.status !== "active") {
        await markEvent(supabase, eventRowId, { status: "ignored", processed_at: new Date().toISOString(), failure_message: "Account is not active." });
        return NextResponse.json({ received: true, ignored: true });
      }
    }

    const connectionPlatformSuite = await createConnectionPlatformSuite({
      supabaseClient: supabase,
      connectionRepositoryStorage: ConnectionRepositoryStorage.SUPABASE,
      credentialReferenceRepositoryStorage: CredentialReferenceRepositoryStorage.SUPABASE,
      institutionReferenceRepositoryStorage: InstitutionReferenceRepositoryStorage.SUPABASE,
      financialAccountRepositoryStorage: FinancialAccountRepositoryStorage.SUPABASE,
      accountBalanceRepositoryStorage: SUPABASE_STORAGE,
      financialEventRepositoryStorage: SUPABASE_STORAGE,
      connectionExecutionHistoryRepositoryStorage: SUPABASE_STORAGE,
    });

    if (event.type === "financial_connections.account.disconnected") {
      const connection = await connectionPlatformSuite.connectionRepository.getById(owning.connectionId, { ownerId: owning.ownerId });
      if (connection) {
        await connectionPlatformSuite.connectionRepository.save(
          { ...connection, status: "needs_attention", updatedAt: new Date().toISOString() },
          { ownerId: owning.ownerId },
        );
      }
      await markEvent(supabase, eventRowId, { status: "processed", processed_at: new Date().toISOString() });
      return NextResponse.json({ received: true });
    }

    if (event.type === "financial_connections.account.reactivated") {
      const connection = await connectionPlatformSuite.connectionRepository.getById(owning.connectionId, { ownerId: owning.ownerId });
      if (connection) {
        await connectionPlatformSuite.connectionRepository.save(
          { ...connection, status: "connected", updatedAt: new Date().toISOString() },
          { ownerId: owning.ownerId },
        );
      }
      await markEvent(supabase, eventRowId, { status: "processed", processed_at: new Date().toISOString() });
      return NextResponse.json({ received: true });
    }

    const refreshField = event.type === "financial_connections.account.refreshed_balance" ? account.balance_refresh : account.transaction_refresh;

    // Converges on the SAME canonical persistence boundary the manual "Execute" sync uses --
    // ConnectionImportExecutionCoordinator, not a separate direct-repository-write path.
    const importResult = await connectionPlatformSuite.connectionImportExecutionCoordinator.executeImport({
      connectionId: owning.connectionId,
      ownerId: owning.ownerId,
    });

    if (event.type === "financial_connections.account.refreshed_transactions" && importResult.success) {
      const connection = await connectionPlatformSuite.connectionRepository.getById(owning.connectionId, { ownerId: owning.ownerId });
      if (connection?.credentialReferenceId) {
        const credentialReference = await connectionPlatformSuite.credentialReferenceRepository.getById(connection.credentialReferenceId, { ownerId: owning.ownerId });
        if (credentialReference) {
          await advanceTransactionRefreshCursor(supabase, connectionPlatformSuite.credentialVaultService, {
            ownerId: owning.ownerId,
            vaultReference: credentialReference.vaultReference,
            accountId: account.id,
            refreshId: refreshField.id ?? null,
          });
        }
      }
    }

    await markEvent(supabase, eventRowId, {
      status: importResult.success ? "processed" : "failed",
      processed_at: new Date().toISOString(),
      failure_message: importResult.success ? null : "Import reported failed records.",
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe Financial Connections webhook rejected", { name: error?.name || "Error", eventRowId });
    if (eventRowId) {
      await supabase.from("connection_webhook_events").update({
        status: "failed", processed_at: new Date().toISOString(), failure_message: "Processing failed.",
      }).eq("id", eventRowId).then(() => {}, () => {});
    }
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
}
