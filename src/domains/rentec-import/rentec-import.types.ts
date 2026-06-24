export type RentecImportRecord = {
  date: string;

  property: string;

  description: string;

  type: "income" | "expense" | "asset_purchase";

  amount: number;

  sourceCategory?: string | null;

  rawRow: Record<string, unknown>;
};

export type RentecImportSummary = {
  totalRows: number;
  importedRows: number;
  skippedRows: number;

  totalIncome: number;
  totalExpenses: number;

  properties: string[];
};
