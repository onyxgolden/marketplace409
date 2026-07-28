export interface CredentialVaultRepository {
  store(
    ownerId: string,
    vaultReference: string,
    secret: string,
  ): Promise<void>;

  retrieve(
    ownerId: string,
    vaultReference: string,
  ): Promise<string | null>;

  delete(
    ownerId: string,
    vaultReference: string,
  ): Promise<boolean>;

  exists(
    ownerId: string,
    vaultReference: string,
  ): Promise<boolean>;
}
