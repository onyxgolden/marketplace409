import type { Entity } from "@/types/entity";
import type {
  ForgeCategory,
  ForgeTransactionKind,
  KnowledgeRecord,
} from "../knowledge/knowledge.types";
import type { Property } from "../property";

export type ResolvedFinancialEventInput = {
  date: string;

  description: string;

  // CANONICAL UNIT CONTRACT: signed DECIMAL DOLLARS, never minor units/cents -- the DIFFERENT unit
  // than Transaction.amountCents (transaction.types.ts) on the other side of the
  // Transaction-to-FinancialEvent boundary. This matches the financial_events.amount column
  // (numeric/decimal) and the convention every other writer to this table already follows
  // (rental Stripe payments, private-financing Stripe payments, manual entries all write exact
  // decimal dollars). See financial-event/minorUnitsToDecimalDollars.ts for the single conversion
  // point a Transaction's amountCents must pass through before becoming this field.
  amount: number;

  resolvedProperty: Property;

  knowledge: KnowledgeRecord;

  sourceSystem: string;

  sourceRecordId?: string | null;

  metadata?: Record<string, unknown> | null;
};

export type FinancialEvent = Entity & {
  owner_id?: string | null;
  organization_id?: string | null;

  property_id?: string | null;
  financial_account_id?: string | null;

  event_date: string;

  description: string;

  // Signed decimal dollars -- same contract as ResolvedFinancialEventInput.amount above.
  amount: number;

  transaction_kind: ForgeTransactionKind;

  normalized_category: ForgeCategory;

  tax_deductible: boolean;

  affects_noi: boolean;

  capitalized: boolean;

  source_system: string;

  source_record_id?: string | null;

  metadata?: Record<string, unknown> | null;
};
