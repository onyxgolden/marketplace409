import {
  CountryCode,
  Products,
} from "plaid";

import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedConnectionApplication,
} from "@/lib/supabase/createAuthenticatedConnectionApplication";

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

    const linkToken =
      await connectionPlatformSuite.plaidProvider
        .createLinkToken({
          userId: ownerId,
          clientName: "409 Marketplace",
          language: "en",
          countryCodes: [CountryCode.Us],
          products: [Products.Transactions],
        });

    return NextResponse.json({
      linkToken,
    });
  } catch (error) {
    const plaidError = error as {
      response?: {
        data?: unknown;
        status?: number;
      };
      message?: string;
    };

    console.error("Plaid Link Token error", {
      status: plaidError.response?.status,
      data: plaidError.response?.data,
      message: plaidError.message,
    });

    const message = error instanceof Error
      ? error.message
      : "Unable to create Plaid Link Token.";

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
