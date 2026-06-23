import { BaseRepository } from "@/repositories";
import { mapLiabilityRowToLiability } from "./liability.mapper";
import type { Liability } from "./liability.types";

class LiabilityRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("liabilities");
  }

  async getAll(): Promise<Liability[]> {
    const rows = await super.getAll();
    return rows.map(mapLiabilityRowToLiability);
  }
}

export const LiabilityRepository = new LiabilityRepositoryImpl();
