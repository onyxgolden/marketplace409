import { FinancialAccountRepository } from "./financial-account.repository";
import type { FinancialAccount } from "./financial-account.types";

class FinancialAccountServiceImpl {
  async getAll(): Promise<FinancialAccount[]> {
    return FinancialAccountRepository.getAll();
  }
}

export const FinancialAccountService = new FinancialAccountServiceImpl();