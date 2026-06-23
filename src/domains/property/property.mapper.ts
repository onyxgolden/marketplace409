import type { Property } from "./property.types";

export function mapPropertyRowToProperty(row: any): Property {
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

    address: row.address,
    city: row.city,
    county: row.county,

    asking_price: row.asking_price,
    arv: row.arv,
    rehab_cost: row.rehab_cost,
    estimated_rent: row.estimated_rent,

    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sqft: row.sqft,

    property_type: row.property_type,
    summary: row.summary,
    image_url: row.image_url,
  };
}
