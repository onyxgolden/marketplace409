import { BaseRepository } from "@/repositories";
import type { Property } from "./property.types";

class PropertyRepositoryImpl extends BaseRepository<Property> {
  constructor() {
    super("investor_properties");
  }
}

export const PropertyRepository = new PropertyRepositoryImpl();