import {
  NextResponse,
} from "next/server";

import {
  mapPlaidExchangeToConnection,
} from "@/domains/plaid-adapter";

import {
  createConnectionPlatformSuite,
} from "@/infrastructure/composition";

import {
  createAuthenticatedFinancialApplication,
} from "@/lib/supabase/createAuthenticatedFinancialApplication";

export async function POST(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedFinancialApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const body = await request.json();

    const publicToken =
      typeof body?.publicToken === "string"
        ? body.publicToken.trim()
        : "";

    if (!publicToken) {
      return NextResponse.json(
        {
          error: "publicToken is required.",
        },
        {
          status: 400,
        },
      );
    }

    const ownerId =
      await authenticatedApplication.currentOwnerId();

    const connectionPlatformSuite =
      createConnectionPlatformSuite({
        supabaseClient:
          authenticatedApplication.supabaseClient,
        currentOwnerId:
          authenticatedApplication.currentOwnerId,
      });

    const exchange =
      await connectionPlatformSuite.plaidProvider
        .exchangePublicToken({
          publicToken,
        });

    const mappedConnection =
      mapPlaidExchangeToConnection({
        userId: ownerId,
        exchange,
      });

    const provisioningResult =
      connectionPlatformSuite.provisioningService
        .provision(mappedConnection);

    const persistenceResult =
      await connectionPlatformSuite.persistenceService
        .persist(
          provisioningResult,
          {
            ownerId,
          },
        );

    return NextResponse.json({
      success: true,
      itemId: exchange.itemId,
      connection: persistenceResult.connection,
      credentialReference:
        persistenceResult.credentialReference,
      institutionReference:
        persistenceResult.institutionReference,
      provisionedAt:
        persistenceResult.provisionedAt,
      persistedAt:
        persistenceResult.persistedAt,
      readyForImport:
        persistenceResult.readyForImport,
    });
  } catch (error) {
    const plaidError = error as {
      response?: {
        data?: unknown;
        status?: number;
      };
      message?: string;
    };

    console.error(
      "Plaid Token Exchange error",
      {
        status: plaidError.response?.status,
        data: plaidError.response?.data,
        message: plaidError.message,
      },
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to exchange Plaid public token.";

    return NextResponse.json(
      {
        error: message,
        details:
          plaidError.response?.data ?? null,
      },
      {
        status: 500,
      },
    );
  }
}
