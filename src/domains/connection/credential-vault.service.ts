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
