import type {
  FinancialAccountImportResult,
} from "../financial-account";

import type {
  AccountBalance,
} from "./account-balance.types";

export type AccountBalanceImportInput =
  FinancialAccountImportResult;

export type AccountBalanceImportResult = Readonly<{
  connection:
    FinancialAccountImportResult["connection"];
  credentialReference:
    FinancialAccountImportResult["credentialReference"];
  institutionReference:
    FinancialAccountImportResult["institutionReference"];
  provider: string;
  connectionId: string;
  success: boolean;
  accountBalances: readonly AccountBalance[];
  importedAccountBalanceCount: number;
  skippedAccountBalanceCount: number;
  failedAccountBalanceCount: number;
  provisionedAt: string;
  persistedAt: string;
  importedAt: string;
  financialAccountsImportedAt: string;
  accountBalancesImportedAt: string;
  readyForTransactionImport: true;
}>;

export function toAccountBalanceImportResult(
  input: AccountBalanceImportInput,
  accountBalances: readonly AccountBalance[],
  skippedAccountBalanceCount: number,
  accountBalancesImportedAt: string,
): AccountBalanceImportResult {
  return Object.freeze({
    connection: input.connection,
    credentialReference:
      input.credentialReference,
    institutionReference:
      input.institutionReference,
    provider: input.provider,
    connectionId: input.connectionId,
    success: input.success,
    accountBalances:
      Object.freeze([...accountBalances]),
    importedAccountBalanceCount:
      accountBalances.length,
    skippedAccountBalanceCount,
    failedAccountBalanceCount: 0,
    provisionedAt: input.provisionedAt,
    persistedAt: input.persistedAt,
    importedAt: input.importedAt,
    financialAccountsImportedAt:
      input.financialAccountsImportedAt,
    accountBalancesImportedAt,
    readyForTransactionImport: true,
  });
}
