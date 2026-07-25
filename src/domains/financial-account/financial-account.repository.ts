import type {
  FinancialAccount,
} from "./financial-account.types";

export type FinancialAccountPersistenceContext = Readonly<{
  ownerId: string;
}>;

export interface FinancialAccountRepository {
  save(
    account: FinancialAccount,
    context?: FinancialAccountPersistenceContext,
  ): Promise<FinancialAccount>;

  saveMany(
    accounts: readonly FinancialAccount[],
    context?: FinancialAccountPersistenceContext,
  ): Promise<readonly FinancialAccount[]>;

  findById(
    id: string,
  ): Promise<FinancialAccount | null>;

  findByOwnerId(
    ownerId: string,
  ): Promise<readonly FinancialAccount[]>;

  findByConnection(
    connectionId: string,
  ): Promise<readonly FinancialAccount[]>;

  findByProviderAccountId(
    provider: string,
    providerAccountId: string,
  ): Promise<FinancialAccount | null>;
}
