import type { Owner } from "./owner.types";

export function mapOwnerRowToOwner(row: any): Owner {
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
    type: row.type,

    primary_user_id: row.primary_user_id,
    notes: row.notes,
  };
}
