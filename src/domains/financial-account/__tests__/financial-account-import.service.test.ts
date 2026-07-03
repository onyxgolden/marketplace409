import { describe, expect, it } from "vitest";

import type {
  AccountImportResult,
} from "../../connection";

import {
  FinancialAccountImportService,
  InMemoryFinancialAccountRepository,
} from "../index";

import type {
  FinancialAccountMapper,
} from "../index";

type ProviderAccount = Readonly<{
  accountId: string;
  name: string;
}>;

const accountImportResult: AccountImportResult = {
  connection: {
    id: "connection_1",
    provider: "plaid",
    providerConnectionId: "item_1",
    institutionId: "institution_1",
    status: "connected",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  credentialReference: {
    id: "credential_1",
    connectionId: "connection_1",
    provider: "plaid",
    providerCredentialId: "item_1",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  institutionReference: {
    id: "institution_1",
    provider: "plaid",
    providerInstitutionId: "ins_1",
    name: "Sandbox Bank",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  provider: "plaid",
  connectionId: "connection_1",
  success: true,
  importedAccountCount: 2,
  skippedAccountCount: 0,
  failedAccountCount: 0,
  provisionedAt: "2026-01-01T00:00:00.000Z",
  persistedAt: "2026-01-01T00:01:00.000Z",
  importedAt: "2026-01-01T00:02:00.000Z",
  readyForTransactionImport: true,
};

class TestFinancialAccountMapper
  implements FinancialAccountMapper<ProviderAccount> {
  mapMany(
    accounts: readonly ProviderAccount[],
    connectionId: string,
    provider: string,
    institutionId: string,
  ) {
    return accounts.map((account) =>
      Object.freeze({
        id: `financial_account_${account.accountId}`,
        connectionId,
        provider,
        providerAccountId: account.accountId,
        institutionId,
        name: account.name,
        officialName: null,
        mask: null,
        type: "depository" as const,
        subtype: "checking",
        currencyCode: "USD",
        active: true,
        createdAt: "2026-01-01T00:03:00.000Z",
        updatedAt: "2026-01-01T00:03:00.000Z",
      }),
    );
  }

  map(
    account: ProviderAccount,
    connectionId: string,
    provider: string,
    institutionId: string,
  ) {
    return this.mapMany(
      [account],
      connectionId,
      provider,
      institutionId,
    )[0];
  }
}

describe("FinancialAccountImportService", () => {
  it("maps provider accounts, persists canonical financial accounts, and returns an immutable result", async () => {
    const repository = new InMemoryFinancialAccountRepository();
    const mapper = new TestFinancialAccountMapper();
    const service = new FinancialAccountImportService(repository, mapper);

    const result = await service.importAccounts(
      accountImportResult,
      [
        {
          accountId: "account_1",
          name: "Checking",
        },
        {
          accountId: "account_2",
          name: "Savings",
        },
      ],
      "2026-01-01T00:04:00.000Z",
    );

    expect(result.connectionId).toBe("connection_1");
    expect(result.provider).toBe("plaid");
    expect(result.success).toBe(true);
    expect(result.importedFinancialAccountCount).toBe(2);
    expect(result.skippedFinancialAccountCount).toBe(0);
    expect(result.failedFinancialAccountCount).toBe(0);
    expect(result.readyForBalanceImport).toBe(true);
    expect(result.financialAccountsImportedAt).toBe(
      "2026-01-01T00:04:00.000Z",
    );

    expect(result.financialAccounts).toHaveLength(2);
    expect(result.financialAccounts[0].providerAccountId).toBe("account_1");

    await expect(
      repository.findByConnection("connection_1"),
    ).resolves.toHaveLength(2);

    expect(Object.isFrozen(result)).toBe(true);
  });
});
