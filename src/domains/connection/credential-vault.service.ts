import type {
  CredentialVaultRepository,
} from "./credential-vault.repository";

import type {
  CredentialVaultStorageInput,
  CredentialVaultStorageResult,
} from "./credential-vault.types";

import {
  toCredentialVaultStorageResult,
} from "./credential-vault.types";

export class CredentialVaultService {
  constructor(
    readonly repository: CredentialVaultRepository,
  ) {}

  async storeCredential(
    input: CredentialVaultStorageInput,
  ): Promise<CredentialVaultStorageResult> {
    assertNonEmptyString(
      input?.ownerId,
      "ownerId",
    );

    assertNonEmptyString(
      input?.vaultReference,
      "vaultReference",
    );

    assertNonEmptyString(
      input?.secret,
      "secret",
    );

    await this.repository.store(
      input.ownerId,
      input.vaultReference,
      input.secret,
    );

    return toCredentialVaultStorageResult(input);
  }

  async retrieveCredential(
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

    return this.repository.retrieve(
      ownerId,
      vaultReference,
    );
  }

  async deleteCredential(
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

    return this.repository.delete(
      ownerId,
      vaultReference,
    );
  }

  async credentialExists(
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

    return this.repository.exists(
      ownerId,
      vaultReference,
    );
  }
}

function assertNonEmptyString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `${fieldName} must be a non-empty string.`,
    );
  }
}
