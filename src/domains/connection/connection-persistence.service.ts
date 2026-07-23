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

export class ConnectionPersistenceService {
  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly credentialReferenceRepository: CredentialReferenceRepository,
    private readonly institutionReferenceRepository: InstitutionReferenceRepository,
  ) {}

  async persist(
    input: ConnectionPersistenceInput,
    context?: ConnectionPersistenceContext,
  ): Promise<ConnectionPersistenceResult> {
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
