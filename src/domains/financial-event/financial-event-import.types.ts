import type { TransactionImportResult } from "../transaction";
import type { FinancialEvent } from "./financial-event.types";

export type FinancialEventImportInput = TransactionImportResult;

export type FinancialEventImportResult = Readonly<{
  connection: TransactionImportResult["connection"];
  credentialReference: TransactionImportResult["credentialReference"];
  institutionReference: TransactionImportResult["institutionReference"];
  provider: string;
  connectionId: string;
  success: boolean;
  financialEvents: readonly FinancialEvent[];
  importedFinancialEventCount: number;
  skippedFinancialEventCount: number;
  failedFinancialEventCount: number;
  provisionedAt: string;
  persistedAt: string;
  importedAt: string;
  financialAccountsImportedAt: string;
  transactionsImportedAt: string;
  financialEventsImportedAt: string;
  readyForLedgerPosting: true;
}>;

export function toFinancialEventImportResult(
  input: FinancialEventImportInput,
  financialEvents: readonly FinancialEvent[],
  financialEventsImportedAt?: string,
): FinancialEventImportResult {
  return {
    connection: input.connection,
    credentialReference: input.credentialReference,
    institutionReference: input.institutionReference,
    provider: input.provider,
    connectionId: input.connectionId,
    success: input.success,
    financialEvents,
    importedFinancialEventCount: financialEvents.length,
    skippedFinancialEventCount: 0,
    failedFinancialEventCount: 0,
    provisionedAt: input.provisionedAt,
    persistedAt: input.persistedAt,
    importedAt: input.importedAt,
    financialAccountsImportedAt: input.financialAccountsImportedAt,
    transactionsImportedAt: input.transactionsImportedAt,
    financialEventsImportedAt:
      financialEventsImportedAt ?? new Date().toISOString(),
    readyForLedgerPosting: true,
  };
}
