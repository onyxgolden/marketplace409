import {
  NextResponse,
} from "next/server";

import {
  parseVaultedState,
  retrieveFinancialConnectionsAccount,
  unsubscribeFinancialConnectionsAccount,
  disconnectFinancialConnectionsAccount,
} from "@/domains/stripe-financial-connections-adapter";

import {
  createAuthenticatedConnectionApplication,
} from "@/lib/supabase/createAuthenticatedConnectionApplication";

import {
  createStripeBillingProvider,
} from "@/infrastructure/billing/StripeBillingProvider";

import type Stripe from "stripe";

// Stripe exposes NO structured error code for "this account is already disconnected" -- confirmed
// by direct inspection of the real API response for both unsubscribe and disconnect on an
// already-disconnected test account: {"error":{"message":"This account has been
// disconnected.","param":"account","type":"invalid_request_error"}}. The installed SDK's
// StripeError DOES support a `code` field for exactly this kind of programmatically-handleable
// case (see node_modules/stripe/cjs/Error.d.ts) -- Stripe simply does not populate one here.
// `type` alone ("invalid_request_error") is far too generic to rely on; it's shared by many
// unrelated validation errors on the same endpoints. Message-text matching is therefore the only
// available signal for this specific case -- isolated to this one narrow helper, and never used
// as a general error-handling pattern elsewhere in this route.
function isAlreadyDisconnectedStripeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const stripeError = error as { type?: unknown; message?: unknown };
  return (
    stripeError.type === "invalid_request_error"
    && typeof stripeError.message === "string"
    && /has been disconnected/i.test(stripeError.message)
  );
}

// Idempotent per-account convergence to "disconnected" on Stripe's side. Retrieves the account's
// CURRENT status first and skips accounts already disconnected -- this alone makes a straight
// repeat of an already-completed disconnect a no-op instead of an error (confirmed live: calling
// unsubscribe/disconnect unconditionally on an already-disconnected account fails the whole
// request with a 500, even though the requested end state was already true). Still handles the
// race where an account's status changes to disconnected AFTER this retrieve but BEFORE the
// unsubscribe/disconnect calls below actually run (e.g. a concurrent disconnect request, or a
// disconnected webhook arriving mid-request) by treating that specific error as successful
// convergence rather than failure. Any OTHER Stripe error (a genuine failure unrelated to
// already-being-disconnected) is rethrown as-is -- this function only ever swallows the one
// narrow, confirmed-safe case, never any error indiscriminately.
async function disconnectAccountIdempotently(stripeClient: Stripe, accountId: string): Promise<void> {
  const currentState = await retrieveFinancialConnectionsAccount(stripeClient, { accountId });
  if (currentState.status === "disconnected") {
    return;
  }

  try {
    await unsubscribeFinancialConnectionsAccount(stripeClient, { accountId });
  } catch (error) {
    if (!isAlreadyDisconnectedStripeError(error)) throw error;
  }

  try {
    await disconnectFinancialConnectionsAccount(stripeClient, { accountId });
  } catch (error) {
    if (!isAlreadyDisconnectedStripeError(error)) throw error;
  }
}

// No existing "remove a connection" flow exists in FORGE for any provider today (confirmed by
// inspection -- Plaid has none either); this is a new, minimal capability, scoped to Stripe
// Financial Connections only. Preserves all prior financial history: never deletes the
// Connection/CredentialReference/FinancialAccount/AccountBalance/FinancialEvent rows, only flips
// the Connection's own status and revokes Stripe-side access going forward.
export async function POST(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedConnectionApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const body = await request.json();
    const connectionId =
      typeof body?.connectionId === "string" ? body.connectionId.trim() : "";

    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required." }, { status: 400 });
    }

    const ownerId = await authenticatedApplication.currentOwnerId();
    const connectionPlatformSuite = await authenticatedApplication.getConnectionPlatformSuite();

    const connection = await connectionPlatformSuite.connectionRepository.getById(connectionId, { ownerId });

    // RLS (has_workspace_access) already restricts getById to rows this owner's workspace can
    // see -- a mismatched/unrelated connection id resolves to null the same way a nonexistent one
    // does. The provider check below is an explicit defense-in-depth guard so this
    // Stripe-specific route can never be used to disconnect a Plaid connection.
    if (!connection || connection.provider !== "stripe_financial_connections") {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }

    if (!connection.credentialReferenceId) {
      return NextResponse.json({ error: "Connection has no credential reference." }, { status: 400 });
    }

    const credentialReference = await connectionPlatformSuite.credentialReferenceRepository.getById(
      connection.credentialReferenceId,
      { ownerId },
    );

    if (!credentialReference) {
      return NextResponse.json({ error: "Credential reference not found." }, { status: 404 });
    }

    const secret = await connectionPlatformSuite.credentialVaultService.retrieveCredential(
      ownerId,
      credentialReference.vaultReference,
    );

    // See stripe-financial-connections.provider.ts's resolveStripeClient for why this cast goes
    // through the real `Stripe` type rather than relying on StripeBillingProvider.js's untyped
    // (effectively `any`) export -- correction report item 1.
    const stripeClient = createStripeBillingProvider().stripe as Stripe;

    if (secret) {
      const vaultedState = parseVaultedState(secret);
      // If ANY account hits an unrelated (non-"already disconnected") Stripe error, this rejects
      // and the whole request fails below -- the local connection status is never updated to
      // "disconnected" in that case (see the catch block), so a genuine failure never gets
      // silently reported as a successful disconnect.
      await Promise.all(
        vaultedState.accountIds.map((accountId) => disconnectAccountIdempotently(stripeClient, accountId)),
      );
    }

    const now = new Date().toISOString();
    const disconnectedConnection = Object.freeze({ ...connection, status: "disconnected" as const, updatedAt: now });
    await connectionPlatformSuite.connectionRepository.save(disconnectedConnection, { ownerId });

    // Audit evidence (Stripe explicitly warned it may request this after the first authorization
    // sessions): records the acting authenticated user (authenticatedApplication.user.id)
    // separately from ownerId (the shared workspace this ran for) -- see
    // 20260908020000_add_connection_execution_history_actor.sql.
    await connectionPlatformSuite.connectionExecutionHistoryRepository.save(
      Object.freeze({
        id: `execution_${connectionId}_disconnect_${now}`,
        ownerId,
        connectionId,
        operationType: "disconnect",
        status: "success",
        provider: "stripe_financial_connections",
        startedAt: now,
        completedAt: now,
        metrics: Object.freeze({}),
        errorDetails: null,
        createdAt: now,
        actorUserId: authenticatedApplication.user.id,
      }),
      { ownerId },
    );

    return NextResponse.json({ success: true, connection: disconnectedConnection });
  } catch (error) {
    console.error("Stripe Financial Connections disconnect error", {
      name: error instanceof Error ? error.name : "Error",
    });

    return NextResponse.json({ error: "Unable to disconnect the Stripe Financial Connections connection." }, { status: 500 });
  }
}
