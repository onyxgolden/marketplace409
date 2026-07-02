import type { CredentialReferenceRepository } from "./credential-reference.repository";
import type { CredentialReference } from "./credential-reference.types";

export class InMemoryCredentialReferenceRepository
  implements CredentialReferenceRepository
{
  private readonly credentialReferences =
    new Map<string, CredentialReference>();

  save(credentialReference: CredentialReference): void {
    this.credentialReferences.set(
      credentialReference.id,
      credentialReference,
    );
  }

  getById(id: string): CredentialReference | null {
    return this.credentialReferences.get(id) ?? null;
  }

  getAll(): CredentialReference[] {
    return [...this.credentialReferences.values()];
  }
}
