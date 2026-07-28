import type {
  ConnectionPersistenceContext,
  ConnectionRepository,
} from "./connection.repository";

import type {
  CredentialReferenceRepository,
} from "./credential-reference.repository";

import type {
  InstitutionReferenceRepository,
} from "./institution-reference.repository";

import type {
  ConnectionPersistenceInput,
  ConnectionPersistenceResult,
} from "./connection-persistence.types";

import {
  toConnectionPersistenceResult,
} from "./connection-persistence.types";

import type {
  CredentialVaultService,
} from "./credential-vault.service";

export class ConnectionPersistenceService {
  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly credentialReferenceRepository: CredentialReferenceRepository,
    private readonly institutionReferenceRepository: InstitutionReferenceRepository,
    private readonly credentialVaultService: CredentialVaultService,
  ) {}

  async persist(
    input: ConnectionPersistenceInput,
    context: ConnectionPersistenceContext,
  ): Promise<ConnectionPersistenceResult> {
    if (input.credentialSecret) {
      await this.credentialVaultService.storeCredential({
        ownerId:
          context.ownerId,
        vaultReference:
          input.credentialReference.vaultReference,
        secret:
          input.credentialSecret,
      });
    }

    await this.credentialReferenceRepository.save(
      input.credentialReference,
      context,
    );

    await this.connectionRepository.save(
      input.connection,
      context,
    );

    await this.institutionReferenceRepository.save(
      input.institutionReference,
      context,
    );

    return toConnectionPersistenceResult(input);
  }
}
