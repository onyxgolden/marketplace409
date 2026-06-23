import type { Asset } from "./asset.types";

export function mapAssetRowToAsset(row: any): Asset {
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

    name: row.name,
    category: row.category,
    type: row.type,

    quantity: row.quantity,
    unit: row.unit,

    current_value: row.current_value,
    cost_basis: row.cost_basis,

    notes: row.notes,
  };
}
