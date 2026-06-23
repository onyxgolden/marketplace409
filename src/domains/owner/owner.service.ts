import { OwnerRepository } from "./owner.repository";
import type { Owner, OwnerType } from "./owner.types";

class OwnerServiceImpl {
  async getAll(): Promise<Owner[]> {
    return OwnerRepository.getAll();
  }

  getDefaultOwnerType(): OwnerType {
    return "person";
  }

  create(name: string, type: OwnerType): Partial<Owner> {
    return {
      name,
      type,
    };
  }
}

export const OwnerService = new OwnerServiceImpl();
