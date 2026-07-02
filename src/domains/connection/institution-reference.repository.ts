import type { InstitutionReference } from "./institution-reference.types";

export interface InstitutionReferenceRepository {
  save(institutionReference: InstitutionReference): void;
  getById(id: string): InstitutionReference | null;
  getAll(): InstitutionReference[];
}
