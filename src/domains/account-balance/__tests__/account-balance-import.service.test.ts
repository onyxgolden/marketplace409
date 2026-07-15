import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  FinancialAccountImportResult,
} from "../../financial-account";

import {
  InMemoryAccountBalanceRepository,
  AccountBalanceImportService,
} from "../index";

import {
  PlaidAccountBalanceMapper,
} from "../../plaid-adapter";

const input:
  FinancialAccountImportResult = {
    connection: {
      id: "connection_1",
      userId: "owner_1",
      name: "Plaid Connection",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId:
        "credential_1",
      createdAt:
        "2026-07-02T00:00:00.000Z",
      updatedAt:
        "2026-07-02T00:00:00.000Z",
    },
    credentialReference: {
      id: "credential_1",
      provider: "plaid",
      externalCredentialId: "item_1",
      vaultReference:
        "vault://plaid/items/item_1/access-token",
      status: "active",
      createdAt:
        "2026-07-02T00:00:00.000Z",
      updatedAt:
        "2026-07-02T00:00:00.000Z",
    },
    institutionReference: {
      id: "institution_1",
      connectionId: "connection_1",
      name: "Sandbox Bank",
      type: "bank",
      provider: "plaid",
      externalInstitutionId: "ins_1",
      createdAt:
        "2026-07-02T00:00:00.000Z",
      updatedAt:
        "2026-07-02T00:00:00.000Z",
    },
    provider: "plaid",
    connectionId: "connection_1",
    success: true,
    financialAccounts: [
      {
        id:
          "financial_account_account_1",
        connectionId: "connection_1",
        provider: "plaid",
        providerAccountId: "account_1",
        institutionId: "institution_1",
        name: "Checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currencyCode: "USD",
        active: true,
        createdAt:
          "2026-07-02T03:00:00.000Z",
        updatedAt:
          "2026-07-02T03:00:00.000Z",
      },
    ],
    importedFinancialAccountCount: 1,
    skippedFinancialAccountCount: 0,
    failedFinancialAccountCount: 0,
    provisionedAt:
      "2026-07-02T01:00:00.000Z",
    persistedAt:
      "2026-07-02T02:00:00.000Z",
    importedAt:
      "2026-07-02T03:00:00.000Z",
    financialAccountsImportedAt:
      "2026-07-02T04:00:00.000Z",
    readyForBalanceImport: true,
  };

describe("AccountBalanceImportService", () => {
  it("maps and persists canonical balances for imported financial accounts", async () => {
    const repository =
      new InMemoryAccountBalanceRepository();

    const service =
      new AccountBalanceImportService(
        repository,
        new PlaidAccountBalanceMapper(),
      );

    const result =
      await service.importBalances(
        input,
        [
          {
            accountId: "account_1",
            current: 1250.55,
            available: 1000.25,
            isoCurrencyCode: "USD",
            unofficialCurrencyCode: null,
          },
        ],
        "2026-07-15T00:00:00.000Z",
      );

    expect(
      result.importedAccountBalanceCount,
    ).toBe(1);

    expect(
      result.skippedAccountBalanceCount,
    ).toBe(0);

    expect(
      result.failedAccountBalanceCount,
    ).toBe(0);

    expect(
      result.readyForTransactionImport,
    ).toBe(true);

    expect(
      result.accountBalancesImportedAt,
    ).toBe(
      "2026-07-15T00:00:00.000Z",
    );

    expect(result.accountBalances[0]).toEqual({
      id:
        "account_balance_plaid_account_1_" +
        "2026-07-15T00:00:00.000Z",
      financialAccountId:
        "financial_account_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "account_1",
      currencyCode: "USD",
      currentBalanceCents: 125055,
      availableBalanceCents: 100025,
      asOf:
        "2026-07-15T00:00:00.000Z",
      createdAt:
        "2026-07-15T00:00:00.000Z",
    });

    await expect(
      repository.findByConnection(
        "connection_1",
      ),
    ).resolves.toHaveLength(1);

    expect(Object.isFrozen(result)).toBe(
      true,
    );

    expect(
      Object.isFrozen(
        result.accountBalances,
      ),
    ).toBe(true);
  });

  it("skips provider balances without a persisted financial account relationship", async () => {
    const repository =
      new InMemoryAccountBalanceRepository();

    const service =
      new AccountBalanceImportService(
        repository,
        new PlaidAccountBalanceMapper(),
      );

    const result =
      await service.importBalances(
        input,
        [
          {
            accountId: "unknown_account",
            current: 50,
            available: null,
            isoCurrencyCode: "USD",
            unofficialCurrencyCode: null,
          },
        ],
        "2026-07-15T00:00:00.000Z",
      );

    expect(
      result.importedAccountBalanceCount,
    ).toBe(0);

    expect(
      result.skippedAccountBalanceCount,
    ).toBe(1);

    expect(result.accountBalances).toEqual(
      [],
    );
  });

  it("propagates explicit owner context to persistence", async () => {
    const repository = {
      saveMany: vi.fn(
        async (balances) => balances,
      ),
    };

    const service =
      new AccountBalanceImportService(
        repository as never,
        new PlaidAccountBalanceMapper(),
      );

    await service.importBalances(
      input,
      [
        {
          accountId: "account_1",
          current: 100,
          available: null,
          isoCurrencyCode: "USD",
          unofficialCurrencyCode: null,
        },
      ],
      "2026-07-15T00:00:00.000Z",
    );

    expect(
      repository.saveMany,
    ).toHaveBeenCalledWith(
      expect.any(Array),
      {
        ownerId: "owner_1",
      },
    );
  });

  it("uses one snapshot timestamp for the complete imported batch", async () => {
    const repository =
      new InMemoryAccountBalanceRepository();

    const mapper = {
      map: vi.fn(
        (
          balance,
          financialAccountId,
          connectionId,
          provider,
          asOf,
        ) => ({
          id:
            `balance_${balance.accountId}`,
          financialAccountId,
          connectionId,
          provider,
          providerAccountId:
            balance.accountId,
          currencyCode: "USD",
          currentBalanceCents: 100,
          availableBalanceCents: null,
          asOf,
          createdAt: asOf,
        }),
      ),
    };

    const service =
      new AccountBalanceImportService(
        repository,
        mapper,
      );

    await service.importBalances(
      input,
      [
        {
          accountId: "account_1",
        },
      ],
      "2026-07-15T12:00:00.000Z",
    );

    expect(mapper.map).toHaveBeenCalledWith(
      expect.any(Object),
      "financial_account_account_1",
      "connection_1",
      "plaid",
      "2026-07-15T12:00:00.000Z",
    );
  });
});
