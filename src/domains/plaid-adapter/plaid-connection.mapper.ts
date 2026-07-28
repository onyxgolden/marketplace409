import type {
  Connection,
  CredentialReference,
  InstitutionReference,
} from "../connection";

import type {
  PlaidPublicTokenExchangeResult,
} from "./plaid.client";

export type PlaidConnectionMappingInput = Readonly<{
  userId: string;
  exchange: PlaidPublicTokenExchangeResult;
  now?: string;
}>;

export type PlaidConnectionMappingResult = Readonly<{
  credentialReference: CredentialReference;
  connection: Connection;
  institutionReference: InstitutionReference;
  credentialSecret: string;
}>;

export function mapPlaidExchangeToConnection(
  input: PlaidConnectionMappingInput,
): PlaidConnectionMappingResult {
  const now = input.now ?? new Date().toISOString();
  const credentialReferenceId = `credential_plaid_${input.exchange.itemId}`;
  const connectionId = `connection_plaid_${input.exchange.itemId}`;
  const institutionReferenceId = `institution_plaid_${input.exchange.itemId}`;

  return {
    credentialSecret: input.exchange.accessToken,
    credentialReference: {
      id: credentialReferenceId,
      provider: "plaid",
      externalCredentialId: input.exchange.itemId,
      vaultReference: `vault://plaid/items/${input.exchange.itemId}/access-token`,
      status: "active",
      lastValidatedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    connection: {
      id: connectionId,
      userId: input.userId,
      name: "Plaid Bank Connection",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId,
      createdAt: now,
      updatedAt: now,
    },
    institutionReference: {
      id: institutionReferenceId,
      connectionId,
      name: "Plaid Institution",
      type: "bank",
      provider: "plaid",
      externalInstitutionId: input.exchange.itemId,
      createdAt: now,
      updatedAt: now,
    },
  };
}
