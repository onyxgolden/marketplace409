import { BaseRepository } from "@/repositories";
import { mapBusinessRowToBusiness } from "./business.mapper";
import type { Business } from "./business.types";

class BusinessRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("businesses");
  }

  async getAll(): Promise<Business[]> {
    const rows = await super.getAll();
    return rows.map(mapBusinessRowToBusiness);
  }

  async getById(id: string): Promise<Business> {
    const row = await super.getById(id);
    return mapBusinessRowToBusiness(row);
  }
}

export const BusinessRepository = new BusinessRepositoryImpl();
