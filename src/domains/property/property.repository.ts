import { BaseRepository } from "@/repositories";
import { mapPropertyRowToProperty } from "./property.mapper";
import type { Property } from "./property.types";

class PropertyRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("investor_properties");
  }

  async getAll(): Promise<Property[]> {
    const rows = await super.getAll();
    return rows.map(mapPropertyRowToProperty);
  }
}

export const PropertyRepository = new PropertyRepositoryImpl();
