import type { Entity } from "@/types/entity";

export type LiabilityCategory =
  | "mortgage"
  | "credit_card"
  | "auto_loan"
  | "student_loan"
  | "personal_loan"
  | "business_loan"
  | "heloc"
  | "medical_debt"
  | "tax_debt"
  | "other";

export type Liability = Entity & {
  owner_id?: string | null;
  financial_account_id?: string | null;

  name: string;
  category: LiabilityCategory;

  current_balance: number;
  interest_rate?: number | null;
  minimum_payment?: number | null;
  original_balance?: number | null;

  due_day?: number | null;
  notes?: string | null;
};