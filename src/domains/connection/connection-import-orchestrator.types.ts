import type {
  Connection,
} from "./connection.types";

import type {
  ConnectionProvider,
  ConnectionProviderImportResult,
} from "./connection-provider.types";

export type ConnectionImportOrchestratorResult = Readonly<{
  provider: string;
  connectionId: string;
  success: boolean;
  importedRecordCount: number;
  skippedRecordCount: number;
  failedRecordCount: number;
  occurredAt: string;
}>;

export type ConnectionImportOrchestratorDependencies = Readonly<{
  provider: ConnectionProvider;
}>;

export type ConnectionImportOrchestratorInput = Readonly<{
  connection: Connection;
}>;

export function toConnectionImportOrchestratorResult(
  result: ConnectionProviderImportResult,
): ConnectionImportOrchestratorResult {
  return {
    provider: result.provider,
    connectionId: result.connectionId,
    success: result.failedRecordCount === 0,
    importedRecordCount: result.importedRecordCount,
    skippedRecordCount: result.skippedRecordCount,
    failedRecordCount: result.failedRecordCount,
    occurredAt: result.occurredAt,
  };
}
