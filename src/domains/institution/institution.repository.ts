import { BaseRepository } from "@/repositories";
import { mapInstitutionRowToInstitution } from "./institution.mapper";
import type { Institution } from "./institution.types";

class InstitutionRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("institutions");
  }

  async getAll(): Promise<Institution[]> {
    const rows = await super.getAll();
    return rows.map(mapInstitutionRowToInstitution);
  }
}

export const InstitutionRepository = new InstitutionRepositoryImpl();
