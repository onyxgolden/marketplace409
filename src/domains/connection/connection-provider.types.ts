import type {
  Connection,
  ConnectionStatus,
} from "./connection.types";

import type {
  ConnectionCapabilities,
} from "./connection-capabilities.types";

import type {
  CredentialReference,
} from "./credential-reference.types";

import type {
  InstitutionReference,
} from "./institution-reference.types";

import type {
  ConnectionHealth,
} from "./connection-health.types";

import type {
  ConnectionImportPayload,
} from "./connection-import-payload.types";

export const CONNECTION_PROVIDER_STATUSES = [
  "available",
  "degraded",
  "unavailable",
  "maintenance",
] as const;

export type ConnectionProviderStatus =
  (typeof CONNECTION_PROVIDER_STATUSES)[number];

export const CONNECTION_PROVIDER_OPERATIONS = [
  "validate_credentials",
  "connect",
  "disconnect",
  "refresh_status",
  "synchronize",
  "import_data",
  "report_health",
] as const;

export type ConnectionProviderOperation =
  (typeof CONNECTION_PROVIDER_OPERATIONS)[number];

export type ConnectionProviderResult = Readonly<{
  provider: string;
  operation: ConnectionProviderOperation;
  success: boolean;
  message?: string;
  occurredAt: string;
}>;

export type ConnectionProviderImportResult = Readonly<{
  provider: string;
  connectionId: string;
  importedRecordCount: number;
  skippedRecordCount: number;
  failedRecordCount: number;
  occurredAt: string;
}>;

export type ConnectionProviderImportPayload =
  ConnectionImportPayload;

export type ConnectionProviderImportContext = Readonly<{
  connection: Connection;
  credentialReference: CredentialReference;
  institutionReference: InstitutionReference;
}>;

export type ConnectionProviderHealth = Readonly<{
  provider: string;
  status: ConnectionProviderStatus;
  label: string;
  checkedAt: string;
}>;

export type ConnectionProvider = Readonly<{
  provider: string;
  displayName: string;

  capabilities(): ConnectionCapabilities;

  validateCredentials(
    credentialReference: CredentialReference,
  ): Promise<ConnectionProviderResult>;

  connect(
    credentialReference: CredentialReference,
  ): Promise<Connection>;

  disconnect(
    connection: Connection,
  ): Promise<ConnectionProviderResult>;

  refreshStatus(
    connection: Connection,
  ): Promise<ConnectionStatus>;

  synchronize(
    connection: Connection,
  ): Promise<ConnectionProviderResult>;

  importData(
    connection: Connection,
    context?: ConnectionProviderImportContext,
  ): Promise<ConnectionProviderImportResult>;

  importDataPayload(
    connection: Connection,
    context?: ConnectionProviderImportContext,
  ): Promise<ConnectionProviderImportPayload>;

  reportHealth(
    connection: Connection,
  ): Promise<ConnectionHealth>;

  providerHealth(): Promise<ConnectionProviderHealth>;
}>;
