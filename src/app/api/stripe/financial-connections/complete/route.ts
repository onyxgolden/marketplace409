import {
  NextResponse,
} from "next/server";

import {
  mapStripeFinancialConnectionsSessionToConnection,
  STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
  StripeFinancialConnectionsAccountMapper,
} from "@/domains/stripe-financial-connections-adapter";

import {
  createAuthenticatedConnectionApplication,
} from "@/lib/supabase/createAuthenticatedConnectionApplication";

// Mirrors /api/plaid/exchange-token. The browser sends ONLY the session id it got back from
// Stripe.js's collectFinancialConnectionsAccounts -- never account ids or account details.
// completeFinancialConnectionsSession (the adapter) re-retrieves the session from Stripe
// server-side and verifies it belongs to this owner's own platform Stripe Customer before this
// route does anything else with it; a session that fails that check throws and this route
// returns 500 without persisting anything. This is the anti-spoofing boundary required by
// capability A/G: never trust owner ids, account ids, or permissions the browser supplies.
export async function POST(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedConnectionApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const body = await request.json();

    const sessionId =
      typeof body?.sessionId === "string"
        ? body.sessionId.trim()
        : "";

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required." },
        { status: 400 },
      );
    }

    const ownerId =
      await authenticatedApplication.currentOwnerId();

    const connectionPlatformSuite =
      await authenticatedApplication
        .getConnectionPlatformSuite();

    // Verification + retrieval ONLY -- does not subscribe yet. See the adapter method's own
    // comment and correction report item 5 for why subscribing is deferred past the durable
    // account-persistence step below.
    const completed =
      await connectionPlatformSuite.stripeFinancialConnectionsProvider
        .completeFinancialConnectionsSession({ ownerId, sessionId });

    const mappedConnection =
      mapStripeFinancialConnectionsSessionToConnection({
        userId: ownerId,
        sessionId: completed.sessionId,
        accounts: completed.accounts,
      });

    const provisioningResult =
      connectionPlatformSuite.provisioningService
        .provision(mappedConnection);

    const persistenceResult =
      await connectionPlatformSuite.persistenceService
        .persist(
          provisioningResult,
          { ownerId },
        );

    // REQUIRED, not best-effort: durably persists a financial_accounts row for every account this
    // session actually authorized, BEFORE subscribing to any of them. This is the fix for the
    // webhook race described in correction report item 5 -- previously, the ONLY thing that ever
    // created these rows was the best-effort full import below, so a webhook arriving before that
    // best-effort import succeeded (or if it failed outright) could never resolve which FORGE
    // connection/owner a Stripe account belonged to, and the event was permanently dropped. Using
    // the existing provider-neutral FinancialAccountImportService/financial_accounts table --
    // no new schema. completed.accounts already carries every field needed (category, subcategory,
    // last4, display/institution name, status) from the verified session -- no second Stripe call.
    // If this throws, the whole completion fails: nothing gets subscribed without a durable record
    // of it existing first.
    const accountMapper = new StripeFinancialConnectionsAccountMapper();
    const canonicalAccounts = accountMapper.mapMany(
      completed.accounts.map((account) => ({ ...account, currency: null })),
      persistenceResult.connection.id,
      STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
      persistenceResult.institutionReference.id,
    );

    const accountsPersistedAt = new Date().toISOString();
    const financialAccountImportResult =
      await connectionPlatformSuite.financialAccountImportService.importCanonicalAccounts(
        {
          connection: persistenceResult.connection,
          credentialReference: persistenceResult.credentialReference,
          institutionReference: persistenceResult.institutionReference,
          provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
          connectionId: persistenceResult.connection.id,
          success: true,
          failedAccountCount: 0,
          provisionedAt: persistenceResult.provisionedAt,
          persistedAt: persistenceResult.persistedAt,
          importedAt: accountsPersistedAt,
        },
        canonicalAccounts,
        accountsPersistedAt,
      );

    // Only now subscribe -- every account id below already has a durably persisted
    // financial_accounts row, so the webhook route's account -> connection/owner lookup can
    // always resolve it from this point forward, regardless of whether the best-effort full
    // import immediately below succeeds. Safe to retry: Stripe's subscribe is idempotent, and
    // mapStripeFinancialConnectionsSessionToConnection/the account mapper both derive stable,
    // deterministic ids from sessionId/accountId, so a retried completion for the same session
    // upserts the same rows rather than duplicating them.
    await connectionPlatformSuite.stripeFinancialConnectionsProvider.subscribeFinancialConnectionsAccounts({
      accountIds: canonicalAccounts.map((account) => account.providerAccountId),
    });

    // Best-effort initial import so the dashboard has real data (balances/transactions)
    // immediately after connecting, instead of the user having to separately click "Execute."
    // Never fails the completion response -- the connection and its accounts are already
    // correctly, durably persisted either way, and the manual-sync path (or the next webhook
    // refresh) can always import later.
    let initialImport = { attempted: true, success: false };
    try {
      const importResult = await connectionPlatformSuite.connectionImportExecutionCoordinator
        .executeImport({ connectionId: persistenceResult.connection.id, ownerId });
      initialImport = { attempted: true, success: importResult.success };
    } catch (importError) {
      console.error("Stripe Financial Connections initial import error", {
        name: importError instanceof Error ? importError.name : "Error",
      });
    }

    return NextResponse.json({
      success: true,
      connection: persistenceResult.connection,
      credentialReference: persistenceResult.credentialReference,
      institutionReference: persistenceResult.institutionReference,
      provisionedAt: persistenceResult.provisionedAt,
      persistedAt: persistenceResult.persistedAt,
      readyForImport: persistenceResult.readyForImport,
      accountCount: completed.accounts.length,
      importedAccountCount: financialAccountImportResult.importedFinancialAccountCount,
      initialImport,
    });
  } catch (error) {
    console.error("Stripe Financial Connections session completion error", {
      name: error instanceof Error ? error.name : "Error",
    });

    const message =
      error instanceof Error && error.message.includes("does not belong to the expected owner")
        ? "This connection could not be verified for your account."
        : "Unable to complete the Stripe Financial Connections session.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
