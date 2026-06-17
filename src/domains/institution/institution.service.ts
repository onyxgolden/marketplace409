import type { Entity } from "@/types/entity";

export type InstitutionType =
  | "bank"
  | "brokerage"
  | "retirement"
  | "crypto"
  | "credit_card"
  | "lender"
  | "manual"
  | "other";

export type Institution = Entity & {
  name: string;
  type: InstitutionType;

  supports_sync: boolean;

  sync_provider?: string | null;

  website?: string | null;
  logo_url?: string | null;
};