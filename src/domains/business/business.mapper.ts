import type { Business } from "./business.types";

export function mapBusinessRowToBusiness(row: any): Business {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,

    name: row.name,
    status: row.status ?? "unclaimed",
    owner_user_id: row.owner_user_id ?? null,

    category: row.category,
    description: row.description,

    address: {
      city: row.city,
    },

    contact: {
      phone: row.phone,
      website_url: row.website_url,
      facebook_url: row.facebook_url,
    },

    image_url: row.image_url,
    trust_tags: row.trust_tags,
  };
}
