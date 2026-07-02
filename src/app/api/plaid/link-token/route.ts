import {
  CountryCode,
  Products,
} from "plaid";

import {
  NextResponse,
} from "next/server";

import {
  createPlaidAdapter,
} from "@/domains/plaid-adapter";

export async function POST() {
  try {
    const adapter = createPlaidAdapter();

    const linkToken = await adapter.createLinkToken({
      userId: "sandbox_user",
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
