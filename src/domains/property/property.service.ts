import { PropertyRepository } from "./property.repository";
import type { Property } from "./property.types";

class PropertyServiceImpl {
  async getAll(): Promise<Property[]> {
    return PropertyRepository.getAll();
  }
}

export const PropertyService = new PropertyServiceImpl();
