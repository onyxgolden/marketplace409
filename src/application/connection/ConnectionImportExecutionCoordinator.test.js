import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionImportExecutionCoordinator,
} from "./ConnectionImportExecutionCoordinator.js";

describe(
  "ConnectionImportExecutionCoordinator",
  () => {
    it(
      "executes an authenticated connection import workflow",
      async () => {
        const connection = {
          id: "connection_1",
          userId: "owner_1",
          name: "Primary Bank",
          type: "bank",
          status: "connected",
          provider: "plaid",
          credentialReferenceId:
            "credential_1",
          createdAt:
            "2026-01-01T00:00:00.000Z",
          updatedAt:
            "2026-01-02T00:00:00.000Z",
        };

        const credentialReference = {
          id: "credential_1",
          provider: "plaid",
        };

        const institutionReference = {
          id: "institution_1",
          connectionId: "connection_1",
          provider: "plaid",
        };

        const payload = {
          provider: "plaid",
          connectionId: "connection_1",
          accounts: [
            {
              accountId: "provider_account_1",
            },
            {
              accountId: "provider_account_2",
            },
          ],
          balances: [
            {
              accountId: "provider_account_1",
            },
          ],
          transactions: [
            {
              transactionId:
                "provider_transaction_1",
              accountId:
                "provider_account_1",
            },
            {
              transactionId:
                "provider_transaction_2",
              accountId:
                "provider_account_2",
            },
          ],
          occurredAt:
            "2026-01-03T00:00:00.000Z",
        };

        const accountImportResult = {
          connection,
          credentialReference,
          institutionReference,
          provider: "plaid",
          connectionId: "connection_1",
          payload,
          success: true,
          importedAccountCount: 2,
          skippedAccountCount: 0,
          failedAccountCount: 0,
          provisionedAt:
            connection.createdAt,
          persistedAt:
            connection.updatedAt,
          importedAt:
            payload.occurredAt,
          readyForTransactionImport: true,
        };

        const financialAccounts = [
          {
            id: "financial_account_1",
            providerAccountId:
              "provider_account_1",
          },
          {
            id: "financial_account_2",
            providerAccountId:
              "provider_account_2",
          },
        ];

        const financialAccountImportResult = {
          ...accountImportResult,
          financialAccounts,
          importedFinancialAccountCount: 2,
          skippedFinancialAccountCount: 0,
          failedFinancialAccountCount: 0,
          financialAccountsImportedAt:
            payload.occurredAt,
          readyForBalanceImport: true,
        };

        const accountBalanceImportResult = {
          ...financialAccountImportResult,
          accountBalances: [
            {
              id: "balance_1",
            },
          ],
          importedAccountBalanceCount: 1,
          skippedAccountBalanceCount: 0,
          failedAccountBalanceCount: 0,
          accountBalancesImportedAt:
            payload.occurredAt,
          readyForTransactionImport: true,
        };

        const accountImportService = {
          importAccounts: vi.fn(
            async () => accountImportResult,
          ),
        };

        const financialAccountImportService = {
          importAccounts: vi.fn(
            async () =>
              financialAccountImportResult,
          ),
        };

        const accountBalanceImportService = {
          importBalances: vi.fn(
            async () =>
              accountBalanceImportResult,
          ),
        };

        const transactionImportService = {
          importTransactionsForAccount:
            vi.fn(
              async (
                input,
                financialAccount,
                providerTransactions,
              ) => ({
                ...input,
                transactions:
                  providerTransactions,
                importedTransactionCount:
                  providerTransactions.length,
                skippedTransactionCount: 0,
                failedTransactionCount: 0,
                transactionsImportedAt:
                  payload.occurredAt,
                readyForFinancialEventImport:
                  true,
              }),
            ),
        };

        const coordinator =
          new ConnectionImportExecutionCoordinator({
            connectionRepository: {
              getById: vi.fn(
                async () => connection,
              ),
            },
            credentialReferenceRepository: {
              getById: vi.fn(
                async () =>
                  credentialReference,
              ),
            },
            institutionReferenceRepository: {
              getAll: vi.fn(
                async () => [
                  institutionReference,
                ],
              ),
            },
            accountImportService,
            financialAccountImportService,
            accountBalanceImportService,
            transactionImportService,
          });

        const result =
          await coordinator.executeImport({
            connectionId: "connection_1",
            ownerId: "owner_1",
          });

        expect(result).toEqual({
          provider: "plaid",
          connectionId: "connection_1",
          success: true,
          financialAccountsImported: 2,
          accountBalancesImported: 1,
          transactionsImported: 2,
          failedRecordCount: 0,
          occurredAt:
            "2026-01-03T00:00:00.000Z",
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          accountImportService.importAccounts,
        ).toHaveBeenCalledWith({
          connection,
          credentialReference,
          institutionReference,
          provisionedAt:
            connection.createdAt,
          persistedAt:
            connection.updatedAt,
          readyForImport: true,
        });

        expect(
          financialAccountImportService
            .importAccounts,
        ).toHaveBeenCalledWith(
          accountImportResult,
          payload.accounts,
          payload.occurredAt,
        );

        expect(
          accountBalanceImportService
            .importBalances,
        ).toHaveBeenCalledWith(
          financialAccountImportResult,
          payload.balances,
          payload.occurredAt,
        );

        expect(
          transactionImportService
            .importTransactionsForAccount,
        ).toHaveBeenCalledTimes(2);

        expect(
          transactionImportService
            .importTransactionsForAccount,
        ).toHaveBeenNthCalledWith(
          1,
          financialAccountImportResult,
          financialAccounts[0],
          [payload.transactions[0]],
          payload.occurredAt,
        );

        expect(
          transactionImportService
            .importTransactionsForAccount,
        ).toHaveBeenNthCalledWith(
          2,
          financialAccountImportResult,
          financialAccounts[1],
          [payload.transactions[1]],
          payload.occurredAt,
        );
      },
    );

    it(
      "rejects an unknown authenticated connection",
      async () => {
        const coordinator =
          new ConnectionImportExecutionCoordinator({
            connectionRepository: {
              getById: vi.fn(
                async () => null,
              ),
            },
            credentialReferenceRepository: {},
            institutionReferenceRepository: {},
            accountImportService: {},
            financialAccountImportService: {},
            accountBalanceImportService: {},
            transactionImportService: {},
          });

        await expect(
          coordinator.executeImport({
            connectionId: "missing",
            ownerId: "owner_1",
          }),
        ).rejects.toThrow(
          "Connection not found for import execution.",
        );
      },
    );
  },
);
