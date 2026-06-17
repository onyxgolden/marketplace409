import type { Entity } from "@/types/entity";

export type FinancialAccountType =
  | "checking"
  | "savings"
  | "money_market"
  | "brokerage"
  | "retirement"
  | "crypto_wallet"
  | "credit_card"
  | "mortgage"
  | "loan"
  | "manual"
  | "other";

export type FinancialAccount = Entity & {
  institution_id?: string | null;

  name: string;
  type: FinancialAccountType;

  account_mask?: string | null;

  current_balance?: number | null;

  supports_sync?: boolean;
  last_synced_at?: string | null;

  notes?: string | null;
};