import type { Relationship } from "./relationship.types";

export function mapRelationshipRowToRelationship(
  row: any
): Relationship {
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

    from_entity_id: row.from_entity_id,
    from_entity_type: row.from_entity_type,

    to_entity_id: row.to_entity_id,
    to_entity_type: row.to_entity_type,

    relationship_type: row.relationship_type,

    ownership_percentage: row.ownership_percentage,

    start_date: row.start_date,
    end_date: row.end_date,

    metadata: row.metadata,
  };
}
