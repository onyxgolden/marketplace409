import {
  NextResponse,
} from "next/server";

import {
  parseVaultedState,
  unsubscribeFinancialConnectionsAccount,
  disconnectFinancialConnectionsAccount,
} from "@/domains/stripe-financial-connections-adapter";

import {
  createAuthenticatedConnectionApplication,
} from "@/lib/supabase/createAuthenticatedConnectionApplication";

import {
  createStripeBillingProvider,
} from "@/infrastructure/billing/StripeBillingProvider";

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

    const stripeClient = createStripeBillingProvider().stripe;

    if (secret) {
      const vaultedState = parseVaultedState(secret);
      await Promise.all(
        vaultedState.accountIds.map(async (accountId) => {
          await unsubscribeFinancialConnectionsAccount(stripeClient, { accountId });
          await disconnectFinancialConnectionsAccount(stripeClient, { accountId });
        }),
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
