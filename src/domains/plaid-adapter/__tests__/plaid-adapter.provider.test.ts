import { describe, expect, it, vi } from "vitest";

import { CountryCode, Products } from "plaid";
import {
  createPlaidAdapter,
} from "../plaid-adapter.provider";

describe("createPlaidAdapter", () => {
  it("creates a Plaid connection provider", () => {
    const adapter = createPlaidAdapter();

    expect(adapter.provider).toBe("plaid");
    expect(adapter.displayName).toBe("Plaid");
  });

  it("declares Plaid-supported capabilities", () => {
    const adapter = createPlaidAdapter();
    const capabilities = adapter.capabilities();

    expect(capabilities.capabilities).toContain("import_transactions");
    expect(capabilities.capabilities).toContain("import_balances");
    expect(capabilities.supportsManualSync).toBe(true);
    expect(capabilities.supportsWebhooks).toBe(true);
  });

  it("exposes Plaid Link Token creation", () => {
    const adapter = createPlaidAdapter();

    expect(typeof adapter.createLinkToken).toBe("function");
  });

  it("exposes Plaid public token exchange", () => {
    const adapter = createPlaidAdapter();

    expect(typeof adapter.exchangePublicToken).toBe("function");
  });

  it("uses an injected Plaid client for Link operations", async () => {
    const plaidClient = {
      linkTokenCreate: vi.fn().mockResolvedValue({
        data: {
          link_token: "injected-link-token",
        },
      }),
      itemPublicTokenExchange: vi.fn().mockResolvedValue({
        data: {
          access_token: "injected-access-token",
          item_id: "injected-item-id",
        },
      }),
    };

    const credentialVaultService = {
      retrieveCredential: vi.fn(),
    };

    const adapter = createPlaidAdapter({
      credentialVaultService,
      plaidClient,
    });

    const linkToken = await adapter.createLinkToken({
      userId: "user_1",
      clientName: "FORGE",
      language: "en",
      countryCodes: [CountryCode.Us],
      products: [Products.Transactions],
    });

    const exchangeResult = await adapter.exchangePublicToken({
      publicToken: "public-token",
    });

    expect(linkToken).toBe("injected-link-token");
    expect(exchangeResult).toEqual({
      accessToken: "injected-access-token",
      itemId: "injected-item-id",
    });

    expect(plaidClient.linkTokenCreate).toHaveBeenCalledOnce();
    expect(
      plaidClient.itemPublicTokenExchange,
    ).toHaveBeenCalledOnce();

    expect(
      credentialVaultService.retrieveCredential,
    ).not.toHaveBeenCalled();
  });

  it("rejects credentials for a different provider", async () => {
    const adapter = createPlaidAdapter();

    const result = await adapter.validateCredentials({
      id: "credential_1",
      provider: "stripe",
      externalCredentialId: "external_1",
      vaultReference: "vault_1",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(result.operation).toBe("validate_credentials");
  });

  it("reports healthy for Plaid connections", async () => {
    const adapter = createPlaidAdapter();

    const health = await adapter.reportHealth({
      id: "connection_1",
      userId: "user_1",
      name: "Checking",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(health.state).toBe("healthy");
    expect(health.allowsImport).toBe(true);
  });
  it("retrieves the Plaid access token for payload import", async () => {
    const credentialVaultService = {
      retrieveCredential: vi.fn().mockResolvedValue(
        "access-token-1",
      ),
    };

    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            {
              account_id: "plaid_account_1",
              name: "Operating Checking",
              official_name:
                "Business Operating Checking",
              mask: "1234",
              type: "depository",
              subtype: "checking",
              balances: {
                current: 1250.55,
                available: 1000.25,
                iso_currency_code: "USD",
                unofficial_currency_code: null,
              },
            },
          ],
          item: {
            item_id: "item_1",
          },
          request_id: "accounts_request_1",
        },
      }),
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            {
              account_id: "plaid_account_1",
              name: "Operating Checking",
              official_name:
                "Business Operating Checking",
              mask: "1234",
              type: "depository",
              subtype: "checking",
              balances: {
                current: 1250.55,
                available: 1000.25,
                iso_currency_code: "USD",
                unofficial_currency_code: null,
              },
            },
          ],
          item: {
            item_id: "item_1",
          },
          request_id: "balances_request_1",
        },
      }),
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [
            {
              transaction_id: "plaid_txn_1",
              account_id: "plaid_account_1",
              date: "2026-01-15",
              name: "Home Depot",
              amount: 125.5,
              category: ["Shops", "Hardware"],
              merchant_name: "Home Depot",
              pending: false,
              payment_channel: "in store",
              authorized_date: "2026-01-14",
              pending_transaction_id: null,
            },
          ],
          modified: [],
          removed: [],
          next_cursor: "cursor_1",
          has_more: false,
        },
      }),
    };

    const adapter = createPlaidAdapter({
      credentialVaultService,
      plaidClient,
    });

    const connection = {
      id: "connection_1",
      userId: "user_1",
      name: "Checking",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as const;

    const payload = await adapter.importDataPayload(
      connection,
      {
        connection,
        credentialReference: {
          id: "credential_1",
          provider: "plaid",
          externalCredentialId: "item_1",
          vaultReference: "vault://plaid/access-token-1",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        institutionReference: {
          id: "institution_1",
          connectionId: "connection_1",
          name: "Test Bank",
          type: "bank",
          provider: "plaid",
          externalInstitutionId: "ins_1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    );

    expect(
      credentialVaultService.retrieveCredential,
    ).toHaveBeenCalledWith(
      "vault://plaid/access-token-1",
    );

    expect(payload).toMatchObject({
      provider: "plaid",
      connectionId: "connection_1",
      accounts: [
        {
          id:
            "financial_account_plaid_plaid_account_1",
          providerAccountId: "plaid_account_1",
          name: "Operating Checking",
        },
      ],
      balances: [
        {
          financialAccountId:
            "financial_account_plaid_plaid_account_1",
          providerAccountId: "plaid_account_1",
          currentBalanceCents: 125055,
          availableBalanceCents: 100025,
        },
      ],
      transactions: [
        {
          id: "transaction_plaid_plaid_txn_1",
          financialAccountId:
            "financial_account_plaid_plaid_account_1",
          providerTransactionId: "plaid_txn_1",
          providerAccountId: "plaid_account_1",
          amountCents: 12550,
          description: "Home Depot",
        },
      ],
    });

    expect(plaidClient.accountsGet)
      .toHaveBeenCalledWith({
        access_token: "access-token-1",
      });

    expect(plaidClient.accountsBalanceGet)
      .toHaveBeenCalledWith({
        access_token: "access-token-1",
      });

    expect(plaidClient.transactionsSync)
      .toHaveBeenCalledWith({
        access_token: "access-token-1",
      });
  });

  it("requires an import context for Plaid payload import", async () => {
    const adapter = createPlaidAdapter({
      credentialVaultService: {
        retrieveCredential: vi.fn(),
      },
    });

    await expect(
      adapter.importDataPayload({
        id: "connection_1",
        userId: "user_1",
        name: "Checking",
        type: "bank",
        status: "connected",
        provider: "plaid",
        credentialReferenceId: "credential_1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(
      "Plaid import context is required.",
    );
  });

  it("requires a credential vault service for Plaid payload import", async () => {
    const adapter = createPlaidAdapter();

    const connection = {
      id: "connection_1",
      userId: "user_1",
      name: "Checking",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as const;

    await expect(
      adapter.importDataPayload(
        connection,
        {
          connection,
          credentialReference: {
            id: "credential_1",
            provider: "plaid",
            externalCredentialId: "item_1",
            vaultReference: "vault://plaid/access-token-1",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          institutionReference: {
            id: "institution_1",
            connectionId: "connection_1",
            name: "Test Bank",
            type: "bank",
            provider: "plaid",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ),
    ).rejects.toThrow(
      "Credential vault service is required for Plaid import.",
    );
  });

  it("rejects a missing Plaid access token", async () => {
    const credentialVaultService = {
      retrieveCredential: vi.fn().mockResolvedValue(null),
    };

    const adapter = createPlaidAdapter({
      credentialVaultService,
    });

    const connection = {
      id: "connection_1",
      userId: "user_1",
      name: "Checking",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as const;

    await expect(
      adapter.importDataPayload(
        connection,
        {
          connection,
          credentialReference: {
            id: "credential_1",
            provider: "plaid",
            externalCredentialId: "item_1",
            vaultReference: "vault://plaid/missing",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          institutionReference: {
            id: "institution_1",
            connectionId: "connection_1",
            name: "Test Bank",
            type: "bank",
            provider: "plaid",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ),
    ).rejects.toThrow(
      "Plaid access token was not found in the credential vault.",
    );
  });

});
