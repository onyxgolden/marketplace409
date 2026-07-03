import type {
  FinancialAccountImportResult,
} from "../financial-account";

import type {
  Transaction,
} from "./transaction.types";

export type TransactionImportInput = FinancialAccountImportResult;

export type TransactionImportResult = Readonly<{
  connection: FinancialAccountImportResult["connection"];
  credentialReference: FinancialAccountImportResult["credentialReference"];
  institutionReference: FinancialAccountImportResult["institutionReference"];
  provider: string;
  connectionId: string;
  success: boolean;
  transactions: readonly Transaction[];
  importedTransactionCount: number;
  skippedTransactionCount: number;
  failedTransactionCount: number;
  provisionedAt: string;
  persistedAt: string;
  importedAt: string;
  financialAccountsImportedAt: string;
  transactionsImportedAt: string;
  readyForFinancialEventImport: true;
}>;

export function toTransactionImportResult(
  input: TransactionImportInput,
  transactions: readonly Transaction[],
  transactionsImportedAt?: string,
): TransactionImportResult {
  return {
    connection: input.connection,
    credentialReference: input.credentialReference,
    institutionReference: input.institutionReference,
    provider: input.provider,
    connectionId: input.connectionId,
    success: input.success,
    transactions,
    importedTransactionCount: transactions.length,
    skippedTransactionCount: 0,
    failedTransactionCount: 0,
    provisionedAt: input.provisionedAt,
    persistedAt: input.persistedAt,
    importedAt: input.importedAt,
    financialAccountsImportedAt: input.financialAccountsImportedAt,
    transactionsImportedAt:
      transactionsImportedAt ?? new Date().toISOString(),
    readyForFinancialEventImport: true,
  };
}
