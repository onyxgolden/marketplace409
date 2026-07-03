import type {
  AccountBalance,
} from "./account-balance.types";

export interface AccountBalanceRepository {
  save(
    balance: AccountBalance,
  ): Promise<AccountBalance>;

  saveMany(
    balances: readonly AccountBalance[],
  ): Promise<readonly AccountBalance[]>;

  findByFinancialAccount(
    financialAccountId: string,
  ): Promise<readonly AccountBalance[]>;

  findLatestByFinancialAccount(
    financialAccountId: string,
  ): Promise<AccountBalance | null>;

  findByConnection(
    connectionId: string,
  ): Promise<readonly AccountBalance[]>;
}
