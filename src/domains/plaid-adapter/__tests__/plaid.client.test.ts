import { describe, expect, it, vi } from "vitest";

import {
  createPlaidLinkToken,
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
      countryCodes: ["US"],
      products: ["transactions"],
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
