import type {
  CredentialVaultRepository,
} from "./credential-vault.repository";

export class InMemoryCredentialVaultRepository
  implements CredentialVaultRepository
{
  private readonly secrets = new Map<string, string>();

  async store(
    ownerId: string,
    vaultReference: string,
    secret: string,
  ): Promise<void> {
    assertNonEmptyString(
      ownerId,
      "ownerId",
    );

    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    assertNonEmptyString(
      secret,
      "secret",
    );

    this.secrets.set(
      createKey(
        ownerId,
        vaultReference,
      ),
      secret,
    );
  }

  async retrieve(
    ownerId: string,
    vaultReference: string,
  ): Promise<string | null> {
    assertNonEmptyString(
      ownerId,
      "ownerId",
    );

    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return (
      this.secrets.get(
        createKey(
          ownerId,
          vaultReference,
        ),
      ) ?? null
    );
  }

  async delete(
    ownerId: string,
    vaultReference: string,
  ): Promise<boolean> {
    assertNonEmptyString(
      ownerId,
      "ownerId",
    );

    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.secrets.delete(
      createKey(
        ownerId,
        vaultReference,
      ),
    );
  }

  async exists(
    ownerId: string,
    vaultReference: string,
  ): Promise<boolean> {
    assertNonEmptyString(
      ownerId,
      "ownerId",
    );

    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.secrets.has(
      createKey(
        ownerId,
        vaultReference,
      ),
    );
  }
}

function createKey(
  ownerId: string,
  vaultReference: string,
): string {
  return `${ownerId}:${vaultReference}`;
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
