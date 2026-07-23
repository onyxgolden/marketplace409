import type {
  CredentialReference,
  CredentialReferenceStatus,
} from "./credential-reference.types";

export type CredentialReferenceRow = Readonly<{
  id: string;
  owner_id: string;
  provider: string;
  external_credential_id: string;
  vault_reference: string;
  status: CredentialReferenceStatus;
  last_validated_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export function mapCredentialReferenceRowToCredentialReference(
  row: CredentialReferenceRow,
): CredentialReference {
  return {
    id: row.id,
    provider: row.provider,
    externalCredentialId:
      row.external_credential_id,
    vaultReference: row.vault_reference,
    status: row.status,
    ...(row.last_validated_at
      ? {
          lastValidatedAt:
            row.last_validated_at,
        }
      : {}),
    ...(row.expires_at
      ? {
          expiresAt: row.expires_at,
        }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
