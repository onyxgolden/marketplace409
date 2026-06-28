import { BusinessRepository } from "./business.repository";
import type { Business } from "./business.types";

class BusinessServiceImpl {
  async getAll(): Promise<Business[]> {
    return BusinessRepository.getAll();
  }

  async getById(id: string): Promise<Business | null> {
    try {
      return await BusinessRepository.getById(id);
    } catch (error) {
      return null;
    }
  }
}

export const BusinessService = new BusinessServiceImpl();
