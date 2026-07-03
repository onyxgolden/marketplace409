import type {
  FinancialAccount,
} from "./financial-account.types";

export interface FinancialAccountRepository {
  save(
    account: FinancialAccount,
  ): Promise<FinancialAccount>;

  saveMany(
    accounts: readonly FinancialAccount[],
  ): Promise<readonly FinancialAccount[]>;

  findById(
    id: string,
  ): Promise<FinancialAccount | null>;

  findByConnection(
    connectionId: string,
  ): Promise<readonly FinancialAccount[]>;

  findByProviderAccountId(
    provider: string,
    providerAccountId: string,
  ): Promise<FinancialAccount | null>;
}
