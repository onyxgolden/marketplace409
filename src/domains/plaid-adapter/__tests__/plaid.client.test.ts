import { describe, expect, it, vi } from "vitest";

import {
  CountryCode,
  Products,
} from "plaid";

import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  getAllPlaidTransactionUpdates,
  getPlaidAccounts,
  getPlaidBalances,
  getPlaidTransactionsSync,
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

describe("getPlaidAccounts", () => {
  it("retrieves accounts using the Plaid access token", async () => {
    const responseData = {
      accounts: [
        {
          account_id: "account-1",
        },
      ],
      item: {
        item_id: "item-1",
      },
      request_id: "request-1",
    };

    const client = {
      accountsGet: vi.fn().mockResolvedValue({
        data: responseData,
      }),
    };

    const result = await getPlaidAccounts(client, {
      accessToken: "access-sandbox-123",
    });

    expect(result).toBe(responseData);
    expect(client.accountsGet).toHaveBeenCalledWith({
      access_token: "access-sandbox-123",
    });
  });
});

describe("getPlaidBalances", () => {
  it("retrieves current balances using the Plaid access token", async () => {
    const responseData = {
      accounts: [
        {
          account_id: "account-1",
          balances: {
            current: 1250,
          },
        },
      ],
      item: {
        item_id: "item-1",
      },
      request_id: "request-1",
    };

    const client = {
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: responseData,
      }),
    };

    const result = await getPlaidBalances(client, {
      accessToken: "access-sandbox-123",
    });

    expect(result).toBe(responseData);
    expect(client.accountsBalanceGet).toHaveBeenCalledWith({
      access_token: "access-sandbox-123",
    });
  });
});

describe("getPlaidTransactionsSync", () => {
  it("retrieves one transaction synchronization page", async () => {
    const responseData = {
      added: [],
      modified: [],
      removed: [],
      next_cursor: "cursor-2",
      has_more: false,
    };

    const client = {
      transactionsSync: vi.fn().mockResolvedValue({
        data: responseData,
      }),
    };

    const result = await getPlaidTransactionsSync(client, {
      accessToken: "access-sandbox-123",
      cursor: "cursor-1",
    });

    expect(result).toBe(responseData);
    expect(client.transactionsSync).toHaveBeenCalledWith({
      access_token: "access-sandbox-123",
      cursor: "cursor-1",
    });
  });

  it("omits the cursor from an initial synchronization request", async () => {
    const client = {
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [],
          modified: [],
          removed: [],
          next_cursor: "cursor-1",
          has_more: false,
        },
      }),
    };

    await getPlaidTransactionsSync(client, {
      accessToken: "access-sandbox-123",
    });

    expect(client.transactionsSync).toHaveBeenCalledWith({
      access_token: "access-sandbox-123",
    });
  });
});

describe("getAllPlaidTransactionUpdates", () => {
  it("retrieves and combines all transaction synchronization pages", async () => {
    const addedTransaction1 = {
      transaction_id: "transaction-added-1",
    };
    const addedTransaction2 = {
      transaction_id: "transaction-added-2",
    };
    const modifiedTransaction = {
      transaction_id: "transaction-modified-1",
    };
    const removedTransaction = {
      transaction_id: "transaction-removed-1",
    };

    const client = {
      transactionsSync: vi.fn()
        .mockResolvedValueOnce({
          data: {
            added: [addedTransaction1],
            modified: [],
            removed: [],
            next_cursor: "cursor-1",
            has_more: true,
          },
        })
        .mockResolvedValueOnce({
          data: {
            added: [addedTransaction2],
            modified: [modifiedTransaction],
            removed: [removedTransaction],
            next_cursor: "cursor-2",
            has_more: false,
          },
        }),
    };

    const result = await getAllPlaidTransactionUpdates(client, {
      accessToken: "access-sandbox-123",
    });

    expect(result).toEqual({
      added: [
        addedTransaction1,
        addedTransaction2,
      ],
      modified: [
        modifiedTransaction,
      ],
      removed: [
        removedTransaction,
      ],
      nextCursor: "cursor-2",
    });

    expect(client.transactionsSync).toHaveBeenNthCalledWith(1, {
      access_token: "access-sandbox-123",
    });

    expect(client.transactionsSync).toHaveBeenNthCalledWith(2, {
      access_token: "access-sandbox-123",
      cursor: "cursor-1",
    });
  });

  it("continues from a supplied synchronization cursor", async () => {
    const client = {
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [],
          modified: [],
          removed: [],
          next_cursor: "cursor-next",
          has_more: false,
        },
      }),
    };

    const result = await getAllPlaidTransactionUpdates(client, {
      accessToken: "access-sandbox-123",
      cursor: "cursor-existing",
    });

    expect(result.nextCursor).toBe("cursor-next");
    expect(client.transactionsSync).toHaveBeenCalledWith({
      access_token: "access-sandbox-123",
      cursor: "cursor-existing",
    });
  });
});
