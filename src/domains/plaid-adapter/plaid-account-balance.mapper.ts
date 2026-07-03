import {
  createAccountBalance,
} from "../account-balance";

import type {
  AccountBalance,
} from "../account-balance";

import type {
  PlaidAccountBalance,
} from "./plaid-account-balance.types";

export class PlaidAccountBalanceMapper {
  map(
    balance: PlaidAccountBalance,
    financialAccountId: string,
    connectionId: string,
    provider: string,
    asOf?: string,
  ): AccountBalance {
    const occurredAt = asOf ?? new Date().toISOString();

    return createAccountBalance({
      id: `account_balance_${provider}_${balance.accountId}_${occurredAt}`,
      financialAccountId,
      connectionId,
      provider,
      providerAccountId: balance.accountId,
      currencyCode:
        balance.isoCurrencyCode ??
        balance.unofficialCurrencyCode ??
        "USD",
      currentBalanceCents: toCents(balance.current),
      availableBalanceCents:
        balance.available === null ? null : toCents(balance.available),
      asOf: occurredAt,
      createdAt: occurredAt,
    });
  }
}

function toCents(
  amount: number,
): number {
  return Math.round(amount * 100);
}
