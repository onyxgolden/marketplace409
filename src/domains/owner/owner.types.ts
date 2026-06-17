import type { Entity } from "@/types/entity";

export type OwnerType =
  | "person"
  | "household"
  | "business"
  | "trust"
  | "partnership"
  | "corporation"
  | "other";

export type Owner = Entity & {
  name: string;
  type: OwnerType;

  primary_user_id?: string | null;
  notes?: string | null;
};