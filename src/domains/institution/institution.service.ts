import { DEFAULT_INSTITUTIONS } from "@/constants/institutions";
import { InstitutionRepository } from "./institution.repository";
import type { Institution } from "./institution.types";

class InstitutionServiceImpl {
  async getAll(): Promise<Institution[]> {
    return InstitutionRepository.getAll();
  }

  getDefaults() {
    return DEFAULT_INSTITUTIONS;
  }

  canSync(institution: Pick<Institution, "supports_sync">): boolean {
    return institution.supports_sync === true;
  }

  isManual(institution: Pick<Institution, "type">): boolean {
    return institution.type === "manual";
  }
}

export const InstitutionService = new InstitutionServiceImpl();
