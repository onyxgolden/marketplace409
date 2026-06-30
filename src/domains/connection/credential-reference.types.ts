export const CREDENTIAL_REFERENCE_STATUSES = [
  "active",
  "pending_validation",
  "expired",
  "revoked",
  "invalid",
] as const;

export type CredentialReferenceStatus =
  (typeof CREDENTIAL_REFERENCE_STATUSES)[number];

export type CredentialReference = Readonly<{
  id: string;
  provider: string;
  externalCredentialId: string;
  vaultReference: string;
  status: CredentialReferenceStatus;
  lastValidatedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}>;
