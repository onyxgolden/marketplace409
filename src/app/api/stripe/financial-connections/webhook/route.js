import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { createFinancialConnectionsWebhookClient } from "@/lib/supabase/createFinancialConnectionsWebhookClient";
import { createConnectionPlatformSuite, ConnectionRepositoryStorage, CredentialReferenceRepositoryStorage, InstitutionReferenceRepositoryStorage, FinancialAccountRepositoryStorage } from "@/infrastructure/composition";
import { parseVaultedState, serializeVaultedState, withUpdatedTransactionRefreshCursor } from "@/domains/stripe-financial-connections-adapter";

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
// configured Stripe SDK instance) and a provider-neutral idempotency table
// (connection_webhook_events) modeled on that webhook's own payment_webhook_events, but with
// stricter retry/claim semantics than that table has -- see the atomic-claim comment below and
// correction report item 7.
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

// The full documented Financial Connections account lifecycle this route acts on (see correction
// report item 6). `account.created` is included as a SUPPORTED event even though its handler is
// almost always a no-op: FORGE's own /complete route already durably persists a financial_accounts
// row for every account it subscribes, synchronously, before subscribing -- so by the time this
// event could plausibly arrive for an account FORGE actually owns, resolveOwningConnection already
// resolves it. `created` is handled here only to acknowledge it correctly (never to attempt a
// speculative import for an account whose owner cannot be determined from the event alone -- FORGE
// does not request the 'ownership' permission, so there is no owner-identifying data on this event
// to safely act on for an account it does not already know about).
// A row stuck in 'processing' longer than this is treated as abandoned by whatever request
// claimed it (confirmed live: a dev-server restart mid-request left a real row permanently
// 'processing', since the normal claim's WHERE clause deliberately excludes 'processing' -- by
// design, to prevent a second concurrent request from also claiming a row that's genuinely still
// being worked on). 5 minutes is far longer than any real import in this route should ever take
// (the slowest observed live run was ~2s), so a row still 'processing' past this age is far more
// likely a crashed/killed attempt than a live one -- long enough to never preempt a real
// in-flight request, short enough that a genuinely stuck event doesn't sit dead for hours.
const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

const SUPPORTED_EVENT_TYPES = new Set([
  "financial_connections.account.created",
  "financial_connections.account.deactivated",
  "financial_connections.account.reactivated",
  "financial_connections.account.disconnected",
  "financial_connections.account.refreshed_balance",
  "financial_connections.account.refreshed_transactions",
]);

// Resolves which FORGE connection/owner a Stripe Financial Connections account id belongs to.
// Relies on a financial_accounts row already existing for it -- true from the moment a session
// completes: the /complete route's account-persistence step is REQUIRED (not best-effort) and
// runs BEFORE the account is ever subscribed, specifically so this lookup can always succeed for
// any account FORGE actually subscribed to, regardless of whether that route's own best-effort
// full (balances/transactions) import later succeeds or fails. See correction report item 5.
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

async function setConnectionStatus(connectionPlatformSuite, owning, status) {
  const connection = await connectionPlatformSuite.connectionRepository.getById(owning.connectionId, { ownerId: owning.ownerId });
  if (!connection) return;
  await connectionPlatformSuite.connectionRepository.save(
    { ...connection, status, updatedAt: new Date().toISOString() },
    { ownerId: owning.ownerId },
  );
}

// Advances the per-account transaction-refresh cursor ONLY after coordinator.executeImport()
// above has already returned success -- never before, never on a throw. Stores ONLY the Stripe
// transaction_refresh.id string (see withUpdatedTransactionRefreshCursor) -- never a wall-clock
// watermark; a failed import leaves the previous cursor value untouched, so the next attempt
// (webhook retry or manual sync) safely re-fetches from the same point.
async function advanceTransactionRefreshCursor(credentialVaultService, { ownerId, vaultReference, accountId, refreshId }) {
  if (!refreshId) return;
  const secret = await credentialVaultService.retrieveCredential(ownerId, vaultReference);
  if (!secret) return;
  const vaultedState = parseVaultedState(secret);
  const nextState = withUpdatedTransactionRefreshCursor(vaultedState, accountId, refreshId);
  await credentialVaultService.storeCredential({ ownerId, vaultReference, secret: serializeVaultedState(nextState) });
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  const supabase = createFinancialConnectionsWebhookClient();
  let eventRowId = null;
  let claimed = false;

  try {
    const stripeBillingProvider = createStripeBillingProvider();
    const secret = configuredWebhookSecret();
    const event = stripeBillingProvider.constructWebhookEvent(rawBody, signature, secret);
    eventRowId = `connection_webhook_stripe_financial_connections_${event.id}`;
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const supported = SUPPORTED_EVENT_TYPES.has(event.type);

    // Insert-or-ignore: on a redelivery of an event id we've already seen, this touches NOTHING
    // -- received_at, status, payload_hash, attempt_count all stay exactly as they were from the
    // FIRST delivery. This is what makes "never overwrite received_at on retry" true by
    // construction, not by remembering not to include it in an update payload.
    const { error: insertError } = await supabase.from("connection_webhook_events").upsert({
      id: eventRowId,
      provider: "stripe_financial_connections",
      provider_event_id: event.id,
      event_type: event.type,
      object_id: event.data?.object?.id ?? null,
      status: supported ? "received" : "ignored",
      payload_hash: payloadHash,
      processed_at: supported ? null : new Date().toISOString(),
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
    if (insertError) throw insertError;

    const { data: row, error: rowError } = await supabase
      .from("connection_webhook_events")
      .select("status, payload_hash, attempt_count, claimed_at")
      .eq("id", eventRowId)
      .single();
    if (rowError) throw rowError;

    // A redelivered event id whose body hash differs from what we originally recorded: Stripe
    // never legitimately reuses an event id for a different payload, so this is flagged and
    // rejected outright rather than processed under either version -- see correction report
    // item 7. Not retried: retrying would replay the exact same mismatch.
    if (row.payload_hash !== payloadHash) {
      console.error("Stripe Financial Connections webhook: duplicate event id with mismatched payload hash", { eventRowId });
      return NextResponse.json({ error: "Event id already used with a different payload." }, { status: 400 });
    }

    // Unsupported event types are always reported the same way (ignored, not "duplicate"),
    // whether this is the first delivery or a redelivery -- the insert-or-ignore above already
    // recorded it as 'ignored' either way, so there is nothing further to do or distinguish.
    if (!supported) {
      return NextResponse.json({ received: true, ignored: true });
    }

    if (row.status === "processed" || row.status === "ignored") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Atomic claim: only a request whose UPDATE actually matches (status still 'received' or
    // 'failed') proceeds past this point. Two concurrent deliveries of the same event both racing
    // to here can only have ONE of them flip the row to 'processing' -- the loser's affected-row
    // count is 0, and it backs off with a retryable response instead of also importing. This is
    // what makes double-processing impossible even under concurrent redelivery, not just unlikely.
    const now = new Date();
    const { data: claimedRows, error: claimError } = await supabase
      .from("connection_webhook_events")
      .update({ status: "processing", attempt_count: (row.attempt_count ?? 0) + 1, claimed_at: now.toISOString() })
      .eq("id", eventRowId)
      .in("status", ["received", "failed"])
      .select("attempt_count");
    if (claimError) throw claimError;

    const claimedAtMs = row.claimed_at ? new Date(row.claimed_at).getTime() : null;
    // A NULL claimed_at means this row transitioned to 'processing' before this column existed
    // (an already-stuck row from before this recovery mechanism was deployed) -- treated as
    // stale, never as "fresh", since there is no evidence it's being actively worked on right
    // now. A plain SQL `claimed_at < threshold` comparison never matches NULL either, so the
    // reclaim query below must check for it explicitly, not just rely on the `<` comparison.
    const isStaleOrUnknown = claimedAtMs === null || now.getTime() - claimedAtMs > STALE_PROCESSING_TIMEOUT_MS;

    if (claimedRows && claimedRows.length > 0) {
      claimed = true;
    } else if (row.status === "processing" && isStaleOrUnknown) {
      // The normal claim refused this row because it's still 'processing' -- but it has been
      // 'processing' for longer than any real request in this route ever takes (or has no
      // claimed_at at all, see above), so the attempt that claimed it is presumed crashed/killed
      // before it could ever mark the row 'failed' or 'processed'. Reclaim it with a SEPARATE,
      // equally atomic UPDATE whose own WHERE clause re-checks claimed_at: if another concurrent
      // request's stale-reclaim UPDATE already won (advancing claimed_at to "now"), THIS UPDATE's
      // condition no longer matches by the time Postgres evaluates it, so it correctly claims 0
      // rows -- exactly the same row-level-locking guarantee the normal claim above relies on,
      // just against a different WHERE clause. Never touches received_at, and still increments
      // attempt_count.
      const staleBeforeIso = new Date(now.getTime() - STALE_PROCESSING_TIMEOUT_MS).toISOString();
      const { data: reclaimedRows, error: reclaimError } = await supabase
        .from("connection_webhook_events")
        .update({ status: "processing", attempt_count: (row.attempt_count ?? 0) + 1, claimed_at: now.toISOString() })
        .eq("id", eventRowId)
        .eq("status", "processing")
        .or(`claimed_at.is.null,claimed_at.lt.${staleBeforeIso}`)
        .select("attempt_count");
      if (reclaimError) throw reclaimError;
      if (reclaimedRows && reclaimedRows.length > 0) {
        claimed = true;
      }
    }

    if (!claimed) {
      // Lost the race (a concurrent attempt is genuinely still fresh, or another request already
      // won the stale-reclaim): ask Stripe to retry later, rather than silently dropping the
      // event or double-processing it ourselves.
      return NextResponse.json({ received: true, retry: true }, { status: 409 });
    }

    // refreshed_balance / refreshed_transactions: check the refresh's own status BEFORE doing any
    // further work -- a webhook fires on every attempt, not just success, and refreshes are
    // asynchronous. A failed/pending refresh, or an inactive account, is acknowledged and
    // ignored, never treated as fresh data or refreshed/imported.
    const account = event.data.object;
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

    const owning = await resolveOwningConnection(supabase, account.id);
    if (!owning) {
      // Cannot yet resolve which FORGE connection owns this Stripe account. Confirmed live: even
      // with durable persistence happening before subscribe (correction report item 5), Stripe's
      // test-mode simulator fired real created/deactivated events essentially instantly upon
      // account selection -- before the browser's modal flow even finished, let alone before
      // /complete's synchronous persistence step ran. That narrow window is real in production
      // too, just smaller. There is no way to tell "this will resolve once /complete finishes"
      // apart from "this account is genuinely foreign/unknown" from this event alone -- both look
      // identical (no matching financial_accounts row) right now.
      //
      // So this is marked RETRYABLE ('failed', not the previous 'ignored'), exactly like a
      // genuine processing failure: the SAME atomic claim mechanism above already allows
      // reclaiming a 'failed' row on a later delivery, with attempt_count incrementing and
      // received_at untouched, same as any other retry. A truly foreign/unknown account (never
      // subscribed by FORGE at all) never resolves no matter how many times it's retried, and
      // simply stops being redelivered once Stripe's own bounded retry window (attempts spread
      // over up to a few days) elapses -- there is no need for this route to invent its own
      // separate "give up after N attempts" policy on top of that; Stripe's own retry-and-give-up
      // behavior is already the correct backstop. This is deliberately NOT applied to the other
      // 'ignored' cases above (unsupported event type, a refresh that didn't succeed, an inactive
      // account) -- those are genuinely terminal: retrying the exact same already-completed
      // refresh attempt, or an event type this route will never act on, cannot change the outcome.
      await markEvent(supabase, eventRowId, {
        status: "failed", processed_at: new Date().toISOString(),
        failure_message: "Ownership not yet resolvable for this Stripe account -- retryable (/complete may still be persisting).",
      });
      return NextResponse.json({ received: true, retry: true }, { status: 409 });
    }

    const connectionPlatformSuite = await createConnectionPlatformSuite({
      supabaseClient: supabase,
      // The resolved canonical workspace owner id (never the acting user -- there is no "acting
      // user" at all on this service-role webhook path, only the owner resolveOwningConnection
      // already looked up above) -- forwarded to FinancialEventImportService by
      // createConnectionPlatformSuite.js. Without this, every webhook-triggered import failed at
      // the financial_events persistence step with "Financial event owner_id is required" --
      // confirmed live by redelivering a real, previously-failed Stripe test-mode webhook event
      // via `stripe events resend` after the OTHER two call sites were already fixed. This route
      // is a third, separate call site of the same composition function; the fix there alone
      // does not help a caller that never passes ownerId in the first place.
      ownerId: owning.ownerId,
      connectionRepositoryStorage: ConnectionRepositoryStorage.SUPABASE,
      credentialReferenceRepositoryStorage: CredentialReferenceRepositoryStorage.SUPABASE,
      institutionReferenceRepositoryStorage: InstitutionReferenceRepositoryStorage.SUPABASE,
      financialAccountRepositoryStorage: FinancialAccountRepositoryStorage.SUPABASE,
      accountBalanceRepositoryStorage: SUPABASE_STORAGE,
      financialEventRepositoryStorage: SUPABASE_STORAGE,
      connectionExecutionHistoryRepositoryStorage: SUPABASE_STORAGE,
    });

    // --- Account lifecycle events (correction report item 6) ---

    if (event.type === "financial_connections.account.created") {
      // Ownership already resolved (owning !== null, checked above) -- nothing further to do;
      // the account was already durably imported by /complete. Never attempts a speculative
      // import here: this event alone carries no owner-identifying data FORGE could use to
      // safely attribute an account it doesn't already know about.
      await markEvent(supabase, eventRowId, { status: "processed", processed_at: new Date().toISOString() });
      return NextResponse.json({ received: true });
    }

    if (event.type === "financial_connections.account.deactivated") {
      // Needs attention + relink offered -- Stripe couldn't refresh this account, but it isn't
      // gone; existing financial history is untouched.
      await setConnectionStatus(connectionPlatformSuite, owning, "needs_attention");
      await markEvent(supabase, eventRowId, { status: "processed", processed_at: new Date().toISOString() });
      return NextResponse.json({ received: true });
    }

    if (event.type === "financial_connections.account.disconnected") {
      // Distinct from "deactivated": the holder (or Stripe) fully revoked this connection.
      // Revokes local active status without deleting financial history -- financial_accounts/
      // account_balances/financial_events rows for this connection are left exactly as they are.
      await setConnectionStatus(connectionPlatformSuite, owning, "disconnected");
      await markEvent(supabase, eventRowId, { status: "processed", processed_at: new Date().toISOString() });
      return NextResponse.json({ received: true });
    }

    if (event.type === "financial_connections.account.reactivated") {
      // Restores eligibility; safe to resume refreshes/imports going forward.
      await setConnectionStatus(connectionPlatformSuite, owning, "connected");
      await markEvent(supabase, eventRowId, { status: "processed", processed_at: new Date().toISOString() });
      return NextResponse.json({ received: true });
    }

    // --- refreshed_balance / refreshed_transactions: the ongoing-sync path ---

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
          await advanceTransactionRefreshCursor(connectionPlatformSuite.credentialVaultService, {
            ownerId: owning.ownerId,
            vaultReference: credentialReference.vaultReference,
            accountId: account.id,
            refreshId: refreshField.id ?? null,
          });
        }
      }
    }

    if (!importResult.success) {
      // A genuinely failed import is retryable -- left in a state ('failed') the atomic claim
      // above will accept again on the next delivery, and reported with a non-2xx so Stripe
      // actually retries it, instead of the event silently vanishing behind a 200.
      await markEvent(supabase, eventRowId, {
        status: "failed", processed_at: new Date().toISOString(), failure_message: "Import reported failed records.",
      });
      return NextResponse.json({ received: true, retry: true }, { status: 500 });
    }

    await markEvent(supabase, eventRowId, { status: "processed", processed_at: new Date().toISOString() });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe Financial Connections webhook rejected", { name: error?.name || "Error", eventRowId, claimed });
    if (eventRowId && claimed) {
      // Only ever transitions a row THIS request itself claimed -- never blind-overwrites a row
      // another concurrent request might be mid-processing.
      await supabase.from("connection_webhook_events").update({
        status: "failed", processed_at: new Date().toISOString(), failure_message: "Processing failed.",
      }).eq("id", eventRowId).then(() => {}, () => {});
      // A genuine internal failure after a successful claim is retryable.
      return NextResponse.json({ error: "Internal error processing Stripe webhook." }, { status: 500 });
    }
    // Signature verification / request-shape failures, or a failure before any claim was won:
    // not this request's place to retry into (a concurrent winner or a future redelivery owns
    // that), and a bad signature will never succeed no matter how many times it's retried.
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
}
