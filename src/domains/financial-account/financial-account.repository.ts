import { BaseRepository } from "@/repositories";
import { mapFinancialAccountRowToFinancialAccount } from "./financial-account.mapper";
import type { FinancialAccount } from "./financial-account.types";

class FinancialAccountRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("financial_accounts");
  }

  async getAll(): Promise<FinancialAccount[]> {
    const rows = await super.getAll();
    return rows.map(mapFinancialAccountRowToFinancialAccount);
  }
}

export const FinancialAccountRepository =
  new FinancialAccountRepositoryImpl();
