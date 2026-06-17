import { DEFAULT_INSTITUTIONS } from "@/constants/institutions";
import type { Institution } from "./institution.types";

export class InstitutionService {
  static getDefaults() {
    return DEFAULT_INSTITUTIONS;
  }

  static canSync(institution: Pick<Institution, "supports_sync">): boolean {
    return institution.supports_sync === true;
  }

  static isManual(institution: Pick<Institution, "type">): boolean {
    return institution.type === "manual";
  }
}