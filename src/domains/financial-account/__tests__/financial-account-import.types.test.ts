import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createFinancialAccount,
} from "../financial-account.types";

import {
  toFinancialAccountImportResult,
} from "../financial-account-import.types";

describe("toFinancialAccountImportResult", () => {
  it("creates an immutable financial account import result", () => {
    const financialAccount = createFinancialAccount({
      id: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "plaid_account_1",
      institutionId: "institution_1",
      name: "Operating Checking",
      officialName: null,
      mask: "1234",
      type: "depository",
      subtype: "checking",
      currencyCode: "USD",
      active: true,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    const result = toFinancialAccountImportResult(
      {
        connection: {
          id: "connection_1",
          userId: "user_1",
          name: "Plaid Connection",
          type: "bank",
          status: "connected",
          provider: "plaid",
          credentialReferenceId: "credential_1",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        credentialReference: {
          id: "credential_1",
          provider: "plaid",
          externalCredentialId: "item_1",
          vaultReference: "vault://plaid/items/item_1/access-token",
          status: "active",
          lastValidatedAt: "2026-07-02T00:00:00.000Z",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        institutionReference: {
          id: "institution_1",
          connectionId: "connection_1",
          name: "Sandbox Bank",
          type: "bank",
          provider: "plaid",
          externalInstitutionId: "ins_1",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        provider: "plaid",
        connectionId: "connection_1",
        payload: {
          provider: "plaid",
          connectionId: "connection_1",
          accounts: [],
          balances: [],
          transactions: [],
          occurredAt:
            "2026-07-02T03:00:00.000Z",
        },
        success: true,
        importedAccountCount: 1,
        skippedAccountCount: 0,
        failedAccountCount: 0,
        provisionedAt: "2026-07-02T01:00:00.000Z",
        persistedAt: "2026-07-02T02:00:00.000Z",
        importedAt: "2026-07-02T03:00:00.000Z",
        readyForTransactionImport: true,
      },
      [financialAccount],
      "2026-07-02T04:00:00.000Z",
    );

    expect(result.importedFinancialAccountCount).toBe(1);
    expect(result.failedFinancialAccountCount).toBe(0);
    expect(result.readyForBalanceImport).toBe(true);
    expect(result.financialAccounts[0]).toEqual(financialAccount);
  });
});
