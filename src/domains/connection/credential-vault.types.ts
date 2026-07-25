export type CredentialVaultStorageInput = Readonly<{
  vaultReference: string;
  secret: string;
  storedAt?: string;
}>;

export type CredentialVaultStorageResult = Readonly<{
  vaultReference: string;
  storedAt: string;
  stored: true;
}>;

export function toCredentialVaultStorageResult(
  input: CredentialVaultStorageInput,
): CredentialVaultStorageResult {
  return {
    vaultReference: input.vaultReference,
    storedAt: input.storedAt ?? new Date().toISOString(),
    stored: true,
  };
}
