import {
  createFinancialAccount,
} from "../financial-account";

import type {
  FinancialAccount,
  FinancialAccountMapper,
  FinancialAccountType,
} from "../financial-account";

import type {
  PlaidAccount,
} from "./plaid-account.types";

export class PlaidFinancialAccountMapper
  implements FinancialAccountMapper<PlaidAccount> {
  map(
    account: PlaidAccount,
    connectionId: string,
    provider: string,
    institutionId: string,
  ): FinancialAccount {
    const now = new Date().toISOString();

    return createFinancialAccount({
      id: `financial_account_${provider}_${account.accountId}`,
      connectionId,
      provider,
      providerAccountId: account.accountId,
      institutionId,
      name: account.name,
      officialName: account.officialName,
      mask: account.mask,
      type: toFinancialAccountType(account.type),
      subtype: account.subtype,
      currencyCode: account.isoCurrencyCode
        ?? account.unofficialCurrencyCode
        ?? "USD",
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  mapMany(
    accounts: readonly PlaidAccount[],
    connectionId: string,
    provider: string,
    institutionId: string,
  ): readonly FinancialAccount[] {
    return accounts.map((account) =>
      this.map(account, connectionId, provider, institutionId),
    );
  }
}

function toFinancialAccountType(
  type: string,
): FinancialAccountType {
  if (
    type === "depository" ||
    type === "credit" ||
    type === "loan" ||
    type === "investment"
  ) {
    return type;
  }

  return "other";
}
