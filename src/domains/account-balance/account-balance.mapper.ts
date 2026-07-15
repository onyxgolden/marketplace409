import {
  createAccountBalance,
} from "./account-balance.types";

import type {
  AccountBalance,
} from "./account-balance.types";

export type AccountBalanceRow = Readonly<{
  id: string;
  financial_account_id: string;
  connection_id: string;
  provider: string;
  provider_account_id: string;
  currency_code: string;
  current_balance_cents: number;
  available_balance_cents: number | null;
  as_of: string;
  created_at: string;
}>;

export function mapAccountBalanceRowToAccountBalance(
  row: AccountBalanceRow,
): AccountBalance {
  return createAccountBalance({
    id: row.id,
    financialAccountId: row.financial_account_id,
    connectionId: row.connection_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    currencyCode: row.currency_code,
    currentBalanceCents: row.current_balance_cents,
    availableBalanceCents: row.available_balance_cents,
    asOf: row.as_of,
    createdAt: row.created_at,
  });
}
