import {
  NextResponse,
} from "next/server";

import {
  mapStripeFinancialConnectionsSessionToConnection,
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

    // Best-effort initial import so the dashboard has real data immediately after connecting,
    // instead of the user having to separately click "Execute." Never fails the completion
    // response -- the connection itself is already correctly persisted either way, and the
    // manual-sync path (or the next webhook refresh) can always import later. This also ensures
    // a financial_accounts row exists for each Stripe account the moment it's subscribed, which
    // is what the webhook route's account -> connection lookup relies on.
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
