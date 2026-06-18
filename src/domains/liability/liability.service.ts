import type { Liability } from "./liability.types";

export class LiabilityService {
  static getTotalBalance(liabilities: Liability[]): number {
    return liabilities.reduce(
      (sum, liability) => sum + liability.current_balance,
      0
    );
  }
}