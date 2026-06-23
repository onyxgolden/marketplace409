import type { FinancialAccount } from "./financial-account.types";

export function mapFinancialAccountRowToFinancialAccount(
  row: any
): FinancialAccount {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,

    institution_id: row.institution_id,

    name: row.name,
    type: row.type,

    account_mask: row.account_mask,

    current_balance: row.current_balance,

    supports_sync: row.supports_sync,

    last_synced_at: row.last_synced_at,

    notes: row.notes,
  };
}
