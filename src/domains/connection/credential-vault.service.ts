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
      input?.vaultReference,
      "vaultReference",
    );

    assertNonEmptyString(
      input?.secret,
      "secret",
    );

    await this.repository.store(
      input.vaultReference,
      input.secret,
    );

    return toCredentialVaultStorageResult(input);
  }

  async retrieveCredential(
    vaultReference: string,
  ): Promise<string | null> {
    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.repository.retrieve(
      vaultReference,
    );
  }

  async deleteCredential(
    vaultReference: string,
  ): Promise<boolean> {
    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.repository.delete(
      vaultReference,
    );
  }

  async credentialExists(
    vaultReference: string,
  ): Promise<boolean> {
    assertNonEmptyString(
      vaultReference,
      "vaultReference",
    );

    return this.repository.exists(
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
