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
