import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedConnectionApplication,
} from "@/lib/supabase/createAuthenticatedConnectionApplication";

// Mirrors /api/plaid/link-token: authenticated, owner/workspace-scoped, server creates the
// provider session and hands the client only what it needs to launch the hosted flow (a client
// secret) -- never a secret key, never an account id or account detail. ownerId here is always
// the server-resolved effective owner (see createAuthenticatedConnectionApplication ->
// resolveEffectiveOwnerId) -- never anything the request body could supply, and this route
// doesn't read a body at all.
export async function POST() {
  try {
    const authenticatedApplication =
      await createAuthenticatedConnectionApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const ownerId =
      await authenticatedApplication.currentOwnerId();

    const connectionPlatformSuite =
      await authenticatedApplication
        .getConnectionPlatformSuite();

    const session =
      await connectionPlatformSuite.stripeFinancialConnectionsProvider
        .createFinancialConnectionsSession({ ownerId });

    return NextResponse.json({
      sessionId: session.sessionId,
      clientSecret: session.clientSecret,
    });
  } catch (error) {
    // Never log the raw error -- it could carry a Stripe client secret or customer id.
    console.error("Stripe Financial Connections session creation error", {
      name: error instanceof Error ? error.name : "Error",
    });

    return NextResponse.json(
      { error: "Unable to create a Stripe Financial Connections session." },
      { status: 500 },
    );
  }
}
