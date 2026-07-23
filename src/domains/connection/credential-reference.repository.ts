import type {
  CredentialReference,
} from "./credential-reference.types";

export type CredentialReferencePersistenceContext = Readonly<{
  ownerId: string;
}>;

export interface CredentialReferenceRepository {
  save(
    credentialReference: CredentialReference,
    context?: CredentialReferencePersistenceContext,
  ): Promise<CredentialReference>;

  getById(
    id: string,
    context?: CredentialReferencePersistenceContext,
  ): Promise<CredentialReference | null>;

  getAll(
    context?: CredentialReferencePersistenceContext,
  ): Promise<readonly CredentialReference[]>;
}
