import type {
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

  persist(
    input: ConnectionPersistenceInput,
  ): ConnectionPersistenceResult {
    this.connectionRepository.save(input.connection);

    this.credentialReferenceRepository.save(
      input.credentialReference,
    );

    this.institutionReferenceRepository.save(
      input.institutionReference,
    );

    return toConnectionPersistenceResult(input);
  }
}
