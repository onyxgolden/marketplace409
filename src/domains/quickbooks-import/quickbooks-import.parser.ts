import type { QuickBooksImportRecord } from "./quickbooks-import.types";

export class QuickBooksImportParser {
  parse(rows: Record<string, string>[]): QuickBooksImportRecord[] {
    return rows.map((row) => ({
      date: row.DATE ?? "",
      description: row.DESCRIPTION ?? "",
      amount: Number(row.AMOUNT ?? 0),
      account: row.ACCOUNT ?? null,
      category: row.CATEGORY ?? null,
      property: row.PROPERTY ?? null,
      sourceRecordId: row.ID ?? null,
      rawRow: row,
    }));
  }
}
