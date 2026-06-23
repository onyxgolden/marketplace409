import type { RentecImportRecord } from "./rentec-import.types";

export class RentecImportParser {
  parse(rows: Record<string, string>[]): RentecImportRecord[] {
    const records: RentecImportRecord[] = [];

    for (const row of rows) {
      const property = (row.PROPERTY ?? "").trim();

      if (!property || property === "Totals") {
        continue;
      }

      const income = this.parseMoney(row.INCOME);
      const expense = this.parseMoney(row.EXPENSE);

      if (income > 0) {
        records.push({
          date: row.DATE,
          property,
          description: (row.DESCRIPTION ?? "").trim(),
          type: "income",
          amount: income,
          sourceCategory: (row.DESCRIPTION ?? "").trim(),
          rawRow: row,
        });
      }

      if (expense > 0) {
        records.push({
          date: row.DATE,
          property,
          description: (row.DESCRIPTION ?? "").trim(),
          type: "expense",
          amount: expense,
          sourceCategory: (row.DESCRIPTION ?? "").trim(),
          rawRow: row,
        });
      }
    }

    return records;
  }

  private parseMoney(value?: string): number {
    if (!value) {
      return 0;
    }

    return Number(value.replace(/[$,]/g, "").trim()) || 0;
  }
}
