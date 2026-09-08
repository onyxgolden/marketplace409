import type {
  AccountImportResult,
} from "../connection";

import type {
  FinancialAccount,
} from "./financial-account.types";

// Narrowed to exactly the fields toFinancialAccountImportResult (below) and
// FinancialAccountImportService actually read -- NOT a `payload`-carrying full AccountImportResult
// (that field, and importedAccountCount/skippedAccountCount, are never read here). Any real
// AccountImportResult (the ConnectionImportExecutionCoordinator's normal input) already satisfies
// this narrower shape structurally, so every existing caller is unaffected. This narrowing exists
// so a caller that has a durable connection/credentialReference/institutionReference but has NOT
// run a full provider import yet (no ConnectionProviderImportPayload to speak of) -- e.g. the
// Stripe Financial Connections session-completion route persisting the account list it already
// has from the verified session, before subscribing -- can call importCanonicalAccounts honestly,
// without fabricating an unused `payload`/count fields just to satisfy a wider declared type. See
// correction report item 5.
export type FinancialAccountImportInput = Readonly<{
  connection: AccountImportResult["connection"];
  credentialReference: AccountImportResult["credentialReference"];
  institutionReference: AccountImportResult["institutionReference"];
  provider: string;
  connectionId: string;
  success: boolean;
  failedAccountCount: number;
  provisionedAt: string;
  persistedAt: string;
  importedAt: string;
}>;

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
