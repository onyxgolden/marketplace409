import type {
  ConnectionPersistenceResult,
} from "./connection-persistence.types";

import type {
  ConnectionProviderImportPayload,
  ConnectionProviderImportResult,
} from "./connection-provider.types";

import type { Connection } from "./connection.types";
import type { CredentialReference } from "./credential-reference.types";
import type { InstitutionReference } from "./institution-reference.types";

export type AccountImportInput =
  ConnectionPersistenceResult &
  Readonly<{
    ownerId: string;
  }>;

export type AccountImportResult = Readonly<{
  connection: Connection;
  credentialReference: CredentialReference;
  institutionReference: InstitutionReference;
  provider: string;
  connectionId: string;
  payload: ConnectionProviderImportPayload;
  success: boolean;
  importedAccountCount: number;
  skippedAccountCount: number;
  failedAccountCount: number;
  provisionedAt: string;
  persistedAt: string;
  importedAt: string;
  readyForTransactionImport: true;
}>;

export function toAccountImportResult(
  input: AccountImportInput,
  providerResult: ConnectionProviderImportResult,
  providerPayload: ConnectionProviderImportPayload,
): AccountImportResult {
  return {
    connection: input.connection,
    credentialReference: input.credentialReference,
    institutionReference: input.institutionReference,
    provider: providerResult.provider,
    connectionId: providerResult.connectionId,
    payload: providerPayload,
    success: providerResult.failedRecordCount === 0,
    importedAccountCount: providerResult.importedRecordCount,
    skippedAccountCount: providerResult.skippedRecordCount,
    failedAccountCount: providerResult.failedRecordCount,
    provisionedAt: input.provisionedAt,
    persistedAt: input.persistedAt,
    importedAt: providerResult.occurredAt,
    readyForTransactionImport: true,
  };
}
