import type { Entity } from "@/types/entity";

export type Property = Entity & {
  owner_id?: string | null;
  organization_id?: string | null;

  address?: string | null;
  city?: string | null;
  county?: string | null;

  asking_price?: number | null;
  arv?: number | null;
  rehab_cost?: number | null;
  estimated_rent?: number | null;

  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;

  property_type?: string | null;
  summary?: string | null;
  image_url?: string | null;

  name?: string;
  sourceSystem?: string | null;
  sourceName?: string | null;
};
