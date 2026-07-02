import type { CredentialReference } from "./credential-reference.types";

export interface CredentialReferenceRepository {
  save(credentialReference: CredentialReference): void;
  getById(id: string): CredentialReference | null;
  getAll(): CredentialReference[];
}
