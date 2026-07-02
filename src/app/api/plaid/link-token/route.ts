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
    const message = error instanceof Error
      ? error.message
      : "Unable to create Plaid Link Token.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
