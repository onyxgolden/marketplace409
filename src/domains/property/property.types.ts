import type { Entity } from "@/types/entity";

export type Property = Entity & {
  address: string;
  city?: string | null;
  county?: string | null;

  asking_price?: number | string | null;
  arv?: number | string | null;
  rehab_cost?: number | string | null;
  estimated_rent?: number | string | null;

  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  sqft?: number | string | null;

  property_type?: string | null;
  summary?: string | null;
  image_url?: string | null;
};