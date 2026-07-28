import type {
  Connection,
  ConnectionHealth,
  ConnectionProviderHealth,
  ConnectionProviderImportContext,
  ConnectionProviderImportResult,
  ConnectionProviderResult,
  ConnectionStatus,
  CredentialReference,
} from "../connection";

import type {
  PlaidAdapter,
} from "./plaid-adapter.types";

import type {
  PlaidAdapterClient,
} from "./plaid.client";

import {
  createPlaidClient,
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  getAllPlaidTransactionUpdates,
  getPlaidAccounts,
  getPlaidBalances,
} from "./plaid.client";

import {
  PlaidFinancialAccountMapper,
} from "./plaid-financial-account.mapper";

import {
  PlaidAccountBalanceMapper,
} from "./plaid-account-balance.mapper";

import {
  PlaidTransactionMapper,
} from "./plaid-transaction.mapper";

export function createPlaidAdapter({
  credentialVaultService,
  plaidClient,
}: {
  credentialVaultService?: {
    retrieveCredential(
      vaultReference: string,
    ): Promise<string | null>;
  };
  plaidClient?: PlaidAdapterClient;
} = {}): PlaidAdapter {
  const resolvePlaidClient = () =>
    plaidClient ?? createPlaidClient();

  const resolvePlaidAccessToken = async (
    context?: ConnectionProviderImportContext,
  ): Promise<string> => {
    if (context === undefined) {
      throw new Error(
        "Plaid import context is required.",
      );
    }

    if (credentialVaultService === undefined) {
      throw new Error(
        "Credential vault service is required for Plaid import.",
      );
    }

    const accessToken =
      await credentialVaultService.retrieveCredential(
        context.credentialReference.vaultReference,
      );

    if (
      accessToken === null ||
      accessToken.trim().length === 0
    ) {
      throw new Error(
        "Plaid access token was not found in the credential vault.",
      );
    }

    return accessToken;
  };

  return {
    provider: "plaid",
    displayName: "Plaid",

    async createLinkToken(request) {
      return createPlaidLinkToken(resolvePlaidClient(), request);
    },

    async exchangePublicToken(request) {
      return exchangePlaidPublicToken(resolvePlaidClient(), request);
    },

    capabilities() {
      const now = new Date().toISOString();

      return {
        connectionId: "plaid",
        capabilities: [
          "import_accounts",
          "import_transactions",
          "import_balances",
          "manual_sync",
          "scheduled_sync",
          "webhook_updates",
        ],
        supportsAutomaticSync: true,
        supportsManualSync: true,
        supportsWebhooks: true,
        supportsRealtimeUpdates: false,
        createdAt: now,
        updatedAt: now,
      };
    },

    async validateCredentials(
      credentialReference: CredentialReference,
    ): Promise<ConnectionProviderResult> {
      return providerResult(
        "validate_credentials",
        credentialReference.provider === "plaid",
      );
    },

    async connect(
      credentialReference: CredentialReference,
    ): Promise<Connection> {
      const now = new Date().toISOString();

      return {
        id: credentialReference.externalCredentialId,
        userId: "pending_user",
        name: "Plaid Connection",
        type: "bank",
        status: "connected",
        provider: "plaid",
        credentialReferenceId: credentialReference.id,
        createdAt: now,
        updatedAt: now,
      };
    },

    async disconnect(
      connection: Connection,
    ): Promise<ConnectionProviderResult> {
      return providerResult("disconnect", connection.provider === "plaid");
    },

    async refreshStatus(
      connection: Connection,
    ): Promise<ConnectionStatus> {
      return connection.provider === "plaid" ? "connected" : "error";
    },

    async synchronize(
      connection: Connection,
    ): Promise<ConnectionProviderResult> {
      return providerResult("synchronize", connection.provider === "plaid");
    },

    async importData(
      connection: Connection,
      context?: ConnectionProviderImportContext,
    ): Promise<ConnectionProviderImportResult> {
      void context;
      return {
        provider: "plaid",
        connectionId: connection.id,
        importedRecordCount: 0,
        skippedRecordCount: 0,
        failedRecordCount: connection.provider === "plaid" ? 0 : 1,
        occurredAt: new Date().toISOString(),
      };
    },

    async importDataPayload(
      connection: Connection,
      context?: ConnectionProviderImportContext,
    ) {
      const accessToken =
        await resolvePlaidAccessToken(context);

      const client = resolvePlaidClient();
      const occurredAt = new Date().toISOString();

      const [
        accountsResponse,
        balancesResponse,
        transactionUpdates,
      ] = await Promise.all([
        getPlaidAccounts(client, {
          accessToken,
        }),
        getPlaidBalances(client, {
          accessToken,
        }),
        getAllPlaidTransactionUpdates(client, {
          accessToken,
        }),
      ]);

      const financialAccountMapper =
        new PlaidFinancialAccountMapper();
      const accountBalanceMapper =
        new PlaidAccountBalanceMapper();
      const transactionMapper =
        new PlaidTransactionMapper();

      const plaidAccounts =
        accountsResponse.accounts.map((account) => ({
          accountId: account.account_id,
          name: account.name,
          officialName: account.official_name ?? null,
          mask: account.mask ?? null,
          type: account.type,
          subtype: account.subtype ?? null,
          isoCurrencyCode:
            account.balances.iso_currency_code ?? null,
          unofficialCurrencyCode:
            account.balances.unofficial_currency_code ?? null,
        }));

      const accounts = financialAccountMapper.mapMany(
        plaidAccounts,
        connection.id,
        "plaid",
        context!.institutionReference.id,
      );

      const financialAccountIdByProviderAccountId =
        new Map(
          accounts.map((account) => [
            account.providerAccountId,
            account.id,
          ]),
        );

      const balances = balancesResponse.accounts.map(
        (account) => {
          const financialAccountId =
            financialAccountIdByProviderAccountId.get(
              account.account_id,
            );

          if (financialAccountId === undefined) {
            throw new Error(
              `Plaid balance references unknown account: ${account.account_id}`,
            );
          }

          return accountBalanceMapper.map(
            {
              accountId: account.account_id,
              current: account.balances.current ?? 0,
              available:
                account.balances.available ?? null,
              isoCurrencyCode:
                account.balances.iso_currency_code ?? null,
              unofficialCurrencyCode:
                account.balances
                  .unofficial_currency_code ?? null,
            },
            financialAccountId,
            connection.id,
            "plaid",
            occurredAt,
          );
        },
      );

      const transactionById = new Map(
        [
          ...transactionUpdates.added,
          ...transactionUpdates.modified,
        ].map((transaction) => [
          transaction.transaction_id,
          transaction,
        ]),
      );

      const transactions = Array.from(
        transactionById.values(),
      ).map((transaction) => {
        const financialAccountId =
          financialAccountIdByProviderAccountId.get(
            transaction.account_id,
          );

        if (financialAccountId === undefined) {
          throw new Error(
            `Plaid transaction references unknown account: ${transaction.account_id}`,
          );
        }

        return transactionMapper.map(
          {
            transactionId:
              transaction.transaction_id,
            accountId: transaction.account_id,
            date: transaction.date,
            name: transaction.name,
            amount: transaction.amount,
            category:
              transaction.category ?? undefined,
            merchantName:
              transaction.merchant_name ?? null,
            pending: transaction.pending,
            raw: {
              paymentChannel:
                transaction.payment_channel,
              authorizedDate:
                transaction.authorized_date ?? null,
              pendingTransactionId:
                transaction.pending_transaction_id ??
                null,
            },
          },
          connection.id,
          "plaid",
          financialAccountId,
          transaction.account_id,
        );
      });

      return {
        provider: "plaid",
        connectionId: connection.id,
        accounts,
        balances,
        transactions,
        occurredAt,
      };
    },

    async reportHealth(
      connection: Connection,
    ): Promise<ConnectionHealth> {
      const now = new Date().toISOString();
      const isPlaidConnection = connection.provider === "plaid";

      return {
        connectionId: connection.id,
        state: isPlaidConnection ? "healthy" : "critical",
        severity: isPlaidConnection ? "healthy" : "critical",
        label: isPlaidConnection ? "Plaid connection ready" : "Invalid provider",
        allowsImport: isPlaidConnection,
        requiresUserAction: !isPlaidConnection,
        issueCount: isPlaidConnection ? 0 : 1,
        warningCount: 0,
        checkedAt: now,
      };
    },

    async providerHealth(): Promise<ConnectionProviderHealth> {
      return {
        provider: "plaid",
        status: "available",
        label: "Plaid adapter available",
        checkedAt: new Date().toISOString(),
      };
    },
  };
}

function providerResult(
  operation: ConnectionProviderResult["operation"],
  success: boolean,
): ConnectionProviderResult {
  return {
    provider: "plaid",
    operation,
    success,
    message: success
      ? "Plaid adapter operation accepted."
      : "Invalid provider for Plaid adapter.",
    occurredAt: new Date().toISOString(),
  };
}
