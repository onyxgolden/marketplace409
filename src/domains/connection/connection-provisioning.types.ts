import type {
  Connection,
} from "./connection.types";

import type {
  CredentialReference,
} from "./credential-reference.types";

import type {
  InstitutionReference,
} from "./institution-reference.types";

export type ConnectionProvisioningInput = Readonly<{
  connection: Connection;
  credentialReference: CredentialReference;
  institutionReference: InstitutionReference;
  provisionedAt?: string;
}>;

export type ConnectionProvisioningResult = Readonly<{
  connection: Connection;
  credentialReference: CredentialReference;
  institutionReference: InstitutionReference;
  provisionedAt: string;
  readyForPersistence: true;
}>;

export function toConnectionProvisioningResult(
  input: ConnectionProvisioningInput,
): ConnectionProvisioningResult {
  return {
    connection: input.connection,
    credentialReference: input.credentialReference,
    institutionReference: input.institutionReference,
    provisionedAt: input.provisionedAt ?? new Date().toISOString(),
    readyForPersistence: true,
  };
}
