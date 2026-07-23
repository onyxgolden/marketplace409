import type {
  CredentialReferencePersistenceContext,
  CredentialReferenceRepository,
} from "./credential-reference.repository";
import type { CredentialReference } from "./credential-reference.types";

export class InMemoryCredentialReferenceRepository
  implements CredentialReferenceRepository
{
  private readonly credentialReferences =
    new Map<string, CredentialReference>();

  async save(
    credentialReference: CredentialReference,
    _context?: CredentialReferencePersistenceContext,
  ): Promise<CredentialReference> {
    this.credentialReferences.set(
      credentialReference.id,
      credentialReference,
    );

    return credentialReference;
  }

  async getById(
    id: string,
  ): Promise<CredentialReference | null> {
    return this.credentialReferences.get(id) ?? null;
  }

  async getAll(
    _context?: CredentialReferencePersistenceContext,
  ): Promise<readonly CredentialReference[]> {
    return [...this.credentialReferences.values()];
  }
}
