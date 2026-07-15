import { describe, expect, it, vi } from "vitest";

import {
  CountryCode,
  Products,
} from "plaid";

import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
} from "../plaid.client";

describe("createPlaidLinkToken", () => {
  it("creates a Plaid Link token request", async () => {
    const client = {
      linkTokenCreate: vi.fn().mockResolvedValue({
        data: {
          link_token: "link-sandbox-123",
        },
      }),
    };

    const token = await createPlaidLinkToken(client, {
      userId: "user_1",
      clientName: "FORGE",
      language: "en",
      countryCodes: [CountryCode.Us],
      products: [Products.Transactions],
    });

    expect(token).toBe("link-sandbox-123");
    expect(client.linkTokenCreate).toHaveBeenCalledWith({
      user: {
        client_user_id: "user_1",
      },
      client_name: "FORGE",
      language: "en",
      country_codes: ["US"],
      products: ["transactions"],
    });
  });
});

describe("exchangePlaidPublicToken", () => {
  it("exchanges a public token for an access token and item id", async () => {
    const client = {
      itemPublicTokenExchange: vi.fn().mockResolvedValue({
        data: {
          access_token: "access-sandbox-123",
          item_id: "item-sandbox-123",
        },
      }),
    };

    const result = await exchangePlaidPublicToken(client, {
      publicToken: "public-sandbox-123",
    });

    expect(result).toEqual({
      accessToken: "access-sandbox-123",
      itemId: "item-sandbox-123",
    });

    expect(client.itemPublicTokenExchange).toHaveBeenCalledWith({
      public_token: "public-sandbox-123",
    });
  });
});
