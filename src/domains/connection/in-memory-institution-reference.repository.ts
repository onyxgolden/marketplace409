import type {
  InstitutionReferencePersistenceContext,
  InstitutionReferenceRepository,
} from "./institution-reference.repository";
import type { InstitutionReference } from "./institution-reference.types";

export class InMemoryInstitutionReferenceRepository
  implements InstitutionReferenceRepository
{
  private readonly institutionReferences =
    new Map<string, InstitutionReference>();

  async save(
    institutionReference: InstitutionReference,
    _context?: InstitutionReferencePersistenceContext,
  ): Promise<InstitutionReference> {
    this.institutionReferences.set(
      institutionReference.id,
      institutionReference,
    );

    return institutionReference;
  }

  async getById(
    id: string,
  ): Promise<InstitutionReference | null> {
    return this.institutionReferences.get(id) ?? null;
  }

  async getAll(
    _context?: InstitutionReferencePersistenceContext,
  ): Promise<readonly InstitutionReference[]> {
    return [...this.institutionReferences.values()];
  }
}
