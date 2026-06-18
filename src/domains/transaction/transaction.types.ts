import type { Entity } from "@/types/entity";

export type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "asset_purchase"
  | "asset_sale"
  | "debt_payment"
  | "adjustment";

export type Transaction = Entity & {
  owner_id?: string | null;
  financial_account_id?: string | null;

  type: TransactionType;

  description: string;
  amount: number;

  transaction_date: string;

  category?: string | null;
  notes?: string | null;
};