import {
  NextResponse,
} from "next/server";

import {
  createPlaidAdapter,
  mapPlaidExchangeToConnection,
} from "@/domains/plaid-adapter";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const publicToken = typeof body?.publicToken === "string"
      ? body.publicToken
      : "";

    const userId = typeof body?.userId === "string" && body.userId.trim()
      ? body.userId
      : "demo_user";

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

    const adapter = createPlaidAdapter();
    const exchange = await adapter.exchangePublicToken({
      publicToken,
    });

    const mappedConnection = mapPlaidExchangeToConnection({
      userId,
      exchange,
    });

    return NextResponse.json({
      success: true,
      itemId: exchange.itemId,
      connection: mappedConnection.connection,
      credentialReference: mappedConnection.credentialReference,
      institutionReference: mappedConnection.institutionReference,
    });
  } catch (error) {
    const plaidError = error as {
      response?: {
        data?: unknown;
        status?: number;
      };
      message?: string;
    };

    console.error("Plaid Token Exchange error", {
      status: plaidError.response?.status,
      data: plaidError.response?.data,
      message: plaidError.message,
    });

    const message = error instanceof Error
      ? error.message
      : "Unable to exchange Plaid public token.";

    return NextResponse.json(
      {
        error: message,
        details: plaidError.response?.data ?? null,
      },
      {
        status: 500,
      },
    );
  }
}
