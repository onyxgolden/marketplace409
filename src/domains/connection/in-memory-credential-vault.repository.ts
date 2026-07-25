import type {
  CredentialVaultRepository,
} from "./credential-vault.repository";

export class InMemoryCredentialVaultRepository
  implements CredentialVaultRepository
{
  private readonly secrets = new Map<string, string>();

  async store(
    vaultReference: string,
    secret: string,
  ): Promise<void> {
    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    assertNonEmptyString(
      secret,
      "secret",
    );

    this.secrets.set(
      vaultReference,
      secret,
    );
  }

  async retrieve(
    vaultReference: string,
  ): Promise<string | null> {
    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.secrets.get(vaultReference) ?? null;
  }

  async delete(
    vaultReference: string,
  ): Promise<boolean> {
    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.secrets.delete(vaultReference);
  }

  async exists(
    vaultReference: string,
  ): Promise<boolean> {
    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.secrets.has(vaultReference);
  }
}

function assertNonEmptyString(
  value: string,
  fieldName: string,
): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `${fieldName} must be a non-empty string.`,
    );
  }
}
