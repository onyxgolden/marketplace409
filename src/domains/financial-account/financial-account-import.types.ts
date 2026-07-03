import type {
  AccountImportResult,
} from "../connection";

import type {
  FinancialAccount,
} from "./financial-account.types";

export type FinancialAccountImportInput = AccountImportResult;

export type FinancialAccountImportResult = Readonly<{
  connection: AccountImportResult["connection"];
  credentialReference: AccountImportResult["credentialReference"];
  institutionReference: AccountImportResult["institutionReference"];
  provider: string;
  connectionId: string;
  success: boolean;
  financialAccounts: readonly FinancialAccount[];
  importedFinancialAccountCount: number;
  skippedFinancialAccountCount: number;
  failedFinancialAccountCount: number;
  provisionedAt: string;
  persistedAt: string;
  importedAt: string;
  financialAccountsImportedAt: string;
  readyForBalanceImport: true;
}>;

export function toFinancialAccountImportResult(
  input: FinancialAccountImportInput,
  financialAccounts: readonly FinancialAccount[],
  financialAccountsImportedAt?: string,
): FinancialAccountImportResult {
  return {
    connection: input.connection,
    credentialReference: input.credentialReference,
    institutionReference: input.institutionReference,
    provider: input.provider,
    connectionId: input.connectionId,
    success: input.success,
    financialAccounts,
    importedFinancialAccountCount: financialAccounts.length,
    skippedFinancialAccountCount: 0,
    failedFinancialAccountCount: input.failedAccountCount,
    provisionedAt: input.provisionedAt,
    persistedAt: input.persistedAt,
    importedAt: input.importedAt,
    financialAccountsImportedAt:
      financialAccountsImportedAt ?? new Date().toISOString(),
    readyForBalanceImport: true,
  };
}
