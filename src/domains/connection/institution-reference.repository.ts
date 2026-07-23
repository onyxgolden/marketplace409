import type {
  InstitutionReference,
} from "./institution-reference.types";

export type InstitutionReferencePersistenceContext = Readonly<{
  ownerId: string;
}>;

export interface InstitutionReferenceRepository {
  save(
    institutionReference: InstitutionReference,
    context?: InstitutionReferencePersistenceContext,
  ): Promise<InstitutionReference>;

  getById(
    id: string,
    context?: InstitutionReferencePersistenceContext,
  ): Promise<InstitutionReference | null>;

  getAll(
    context?: InstitutionReferencePersistenceContext,
  ): Promise<readonly InstitutionReference[]>;
}
