import type { RentecImportRecord } from "./rentec-import.types";

type RentecCsvRow = Record<string, string>;

export class RentecImportParser {
  parseCsv(csv: string): RentecImportRecord[] {
    return this.parse(this.parseCsvRows(csv));
  }

  parse(rows: RentecCsvRow[]): RentecImportRecord[] {
    const records: RentecImportRecord[] = [];

    for (const row of rows) {
      const property = (row.PROPERTY ?? "").trim();
      const description = (row.DESCRIPTION ?? "").trim();

      if (!property || property === "Totals") {
        continue;
      }

      const income = this.parseMoney(row.INCOME);
      const expense = this.parseMoney(row.EXPENSE);
      const transactionDate = this.normalizeDate(row.DATE);

      if (income > 0) {
        records.push({
          date: transactionDate,
          property,
          description,
          type: "income",
          amount: income,
          sourceCategory: description,
          rawRow: row,
        });
      }

      if (expense > 0) {
        records.push({
          date: transactionDate,
          property,
          description,
          type: this.inferExpenseType(description),
          amount: expense,
          sourceCategory: description,
          rawRow: row,
        });
      }
    }

    return records;
  }

  private parseCsvRows(csv: string): RentecCsvRow[] {
    const lines = csv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const headers = this.parseCsvLine(lines[0]);

    return lines.slice(1).map((line) => {
      const values = this.parseCsvLine(line);

      return headers.reduce<RentecCsvRow>((row, header, index) => {
        row[header] = values[index] ?? "";
        return row;
      }, {});
    });
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const character of line) {
      if (character === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (character === "," && !inQuotes) {
        values.push(current);
        current = "";
        continue;
      }

      current += character;
    }

    values.push(current);

    return values.map((value) => value.trim());
  }

  private parseMoney(value?: string): number {
    if (!value) {
      return 0;
    }

    return Number(value.replace(/[$,]/g, "").trim()) || 0;
  }

  private normalizeDate(value?: string): string {
    if (!value) {
      return "";
    }

    const [month, day, year] = value.split("/");

    if (!month || !day || !year) {
      return value;
    }

    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(
      2,
      "0"
    )}`;
  }

  private inferExpenseType(description: string): "expense" | "asset_purchase" {
    if (description.toLowerCase().includes("purchase price")) {
      return "asset_purchase";
    }

    return "expense";
  }
}
