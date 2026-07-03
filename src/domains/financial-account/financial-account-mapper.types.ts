import type {
  FinancialAccount,
} from "./financial-account.types";

export interface FinancialAccountMapper<
  TProviderAccount = unknown,
> {
  map(
    account: TProviderAccount,
    connectionId: string,
    provider: string,
    institutionId: string,
  ): FinancialAccount;

  mapMany(
    accounts: readonly TProviderAccount[],
    connectionId: string,
    provider: string,
    institutionId: string,
  ): readonly FinancialAccount[];
}

