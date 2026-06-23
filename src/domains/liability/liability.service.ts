import { LiabilityRepository } from "./liability.repository";
import type { Liability } from "./liability.types";

class LiabilityServiceImpl {
  async getAll(): Promise<Liability[]> {
    return LiabilityRepository.getAll();
  }

  getTotalBalance(liabilities: Liability[]): number {
    return liabilities.reduce(
      (sum, liability) => sum + liability.current_balance,
      0
    );
  }
}

export const LiabilityService = new LiabilityServiceImpl();
