import type {
  ConnectionProvisioningResult,
} from "./connection-provisioning.types";

import type { Connection } from "./connection.types";
import type { CredentialReference } from "./credential-reference.types";
import type { InstitutionReference } from "./institution-reference.types";

export type ConnectionPersistenceInput = ConnectionProvisioningResult;

export type ConnectionPersistenceResult = Readonly<{
  connection: Connection;
  credentialReference: CredentialReference;
  institutionReference: InstitutionReference;
  provisionedAt: string;
  persistedAt: string;
  readyForImport: true;
}>;

export function toConnectionPersistenceResult(
  input: ConnectionPersistenceInput,
  persistedAt?: string,
): ConnectionPersistenceResult {
  return {
    connection: input.connection,
    credentialReference: input.credentialReference,
    institutionReference: input.institutionReference,
    provisionedAt: input.provisionedAt,
    persistedAt: persistedAt ?? new Date().toISOString(),
    readyForImport: true,
  };
}
