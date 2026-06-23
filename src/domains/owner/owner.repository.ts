import { BaseRepository } from "@/repositories";
import { mapOwnerRowToOwner } from "./owner.mapper";
import type { Owner } from "./owner.types";

class OwnerRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("owners");
  }

  async getAll(): Promise<Owner[]> {
    const rows = await super.getAll();
    return rows.map(mapOwnerRowToOwner);
  }
}

export const OwnerRepository = new OwnerRepositoryImpl();
