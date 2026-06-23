import type { Liability } from "./liability.types";

export function mapLiabilityRowToLiability(row: any): Liability {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,

    created_by: row.created_by,
    updated_by: row.updated_by,

    owner_id: row.owner_id,
    organization_id: row.organization_id,

    status: row.status,

    is_deleted: row.is_deleted,
    deleted_at: row.deleted_at,

    financial_account_id: row.financial_account_id,

    name: row.name,
    category: row.category,

    current_balance: row.current_balance,
    interest_rate: row.interest_rate,
    minimum_payment: row.minimum_payment,
    original_balance: row.original_balance,

    due_day: row.due_day,
    notes: row.notes,
  };
}
