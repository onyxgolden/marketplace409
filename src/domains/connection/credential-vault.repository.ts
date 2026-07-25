export interface CredentialVaultRepository {
  store(
    vaultReference: string,
    secret: string,
  ): Promise<void>;

  retrieve(
    vaultReference: string,
  ): Promise<string | null>;

  delete(
    vaultReference: string,
  ): Promise<boolean>;

  exists(
    vaultReference: string,
  ): Promise<boolean>;
}
