import type { InstitutionReferenceRepository } from "./institution-reference.repository";
import type { InstitutionReference } from "./institution-reference.types";

export class InMemoryInstitutionReferenceRepository
  implements InstitutionReferenceRepository
{
  private readonly institutionReferences =
    new Map<string, InstitutionReference>();

  save(institutionReference: InstitutionReference): void {
    this.institutionReferences.set(
      institutionReference.id,
      institutionReference,
    );
  }

  getById(id: string): InstitutionReference | null {
    return this.institutionReferences.get(id) ?? null;
  }

  getAll(): InstitutionReference[] {
    return [...this.institutionReferences.values()];
  }
}
