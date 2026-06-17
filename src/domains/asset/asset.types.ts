import type { Entity } from "@/types/entity";

export type AssetCategory =
  | "cash"
  | "investment"
  | "real_estate"
  | "business"
  | "digital_asset"
  | "precious_metal"
  | "vehicle"
  | "collectible"
  | "other";

export type Asset = Entity & {
  name: string;
  category: AssetCategory;
  type?: string | null;

  quantity?: number | null;
  unit?: string | null;

  current_value: number;
  cost_basis?: number | null;

  
  notes?: string | null;
};