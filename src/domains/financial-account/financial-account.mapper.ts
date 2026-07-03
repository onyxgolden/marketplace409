import {
  createFinancialAccount,
} from "./financial-account.types";

import type {
  FinancialAccount,
  FinancialAccountType,
} from "./financial-account.types";

export type FinancialAccountRow = Readonly<{
  id: string;
  connection_id: string;
  provider: string;
  provider_account_id: string;
  institution_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: FinancialAccountType;
  subtype: string | null;
  currency_code: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}>;

export function mapFinancialAccountRowToFinancialAccount(
  row: FinancialAccountRow,
): FinancialAccount {
  return createFinancialAccount({
    id: row.id,
    connectionId: row.connection_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    institutionId: row.institution_id,
    name: row.name,
    officialName: row.official_name,
    mask: row.mask,
    type: row.type,
    subtype: row.subtype,
    currencyCode: row.currency_code,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
