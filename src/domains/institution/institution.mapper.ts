import type { Institution } from "./institution.types";

export function mapInstitutionRowToInstitution(row: any): Institution {
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

    supports_sync: row.supports_sync,

    sync_provider: row.sync_provider,

    website: row.website,
    logo_url: row.logo_url,
  };
}
