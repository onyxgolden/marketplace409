import { BusinessRepository } from "./business.repository";
import type { Business } from "./business.types";

class BusinessServiceImpl {
  async getAll(): Promise<Business[]> {
    return BusinessRepository.getAll();
  }

  async getById(id: string): Promise<Business> {
    return BusinessRepository.getById(id);
  }
}

export const BusinessService = new BusinessServiceImpl();
