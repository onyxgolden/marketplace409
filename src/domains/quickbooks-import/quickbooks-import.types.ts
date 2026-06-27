import type { ResolvedFinancialEventInput } from "../financial-event";

export type QuickBooksImportRecord = {
  date: string;

  description: string;

  amount: number;

  account?: string | null;

  category?: string | null;

  property?: string | null;

  sourceRecordId?: string | null;

  rawRow: Record<string, unknown>;
};

export type ResolvedQuickBooksImportRecord = ResolvedFinancialEventInput;
