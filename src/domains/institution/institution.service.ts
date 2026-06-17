import type { Institution } from "./institution.types";

export class InstitutionService {
  static canSync(institution: Institution): boolean {
    return institution.supports_sync === true;
  }

  static isManual(institution: Institution): boolean {
    return institution.type === "manual";
  }
}