import type {
  AccountBalance,
} from "./account-balance.types";

export type AccountBalancePersistenceContext = Readonly<{
  ownerId: string;
}>;

export interface AccountBalanceRepository {
  save(
    balance: AccountBalance,
    context?: AccountBalancePersistenceContext,
  ): Promise<AccountBalance>;

  saveMany(
    balances: readonly AccountBalance[],
    context?: AccountBalancePersistenceContext,
  ): Promise<readonly AccountBalance[]>;

  findLatestByOwnerId(
    ownerId: string,
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
