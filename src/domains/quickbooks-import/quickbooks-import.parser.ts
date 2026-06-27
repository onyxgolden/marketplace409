import type { QuickBooksImportRecord } from "./quickbooks-import.types";

type QuickBooksCsvRow = Record<string, string>;

export class QuickBooksImportParser {
  parseCsv(csv: string): QuickBooksImportRecord[] {
    return this.parse(this.parseCsvRows(csv));
  }

  parse(rows: QuickBooksCsvRow[]): QuickBooksImportRecord[] {
    return rows
      .map((row) => ({
        date: this.normalizeDate(row.DATE ?? row.Date),
        description: (row.DESCRIPTION ?? row.Description ?? row.Memo ?? "").trim(),
        amount: this.parseMoney(row.AMOUNT ?? row.Amount),
        account: row.ACCOUNT ?? row.Account ?? null,
        category: row.CATEGORY ?? row.Category ?? row["Transaction Type"] ?? null,
        property: row.PROPERTY ?? row.Property ?? row.Class ?? null,
        sourceRecordId: row.ID ?? row.Id ?? row["Transaction ID"] ?? null,
        rawRow: row,
      }))
      .filter((record) => record.date || record.description || record.amount !== 0);
  }

  private parseCsvRows(csv: string): QuickBooksCsvRow[] {
    const lines = csv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    const headers = this.parseCsvLine(lines[0]);

    return lines.slice(1).map((line) => {
      const values = this.parseCsvLine(line);

      return headers.reduce<QuickBooksCsvRow>((row, header, index) => {
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

    const trimmedValue = value.trim();
    const isParenthesizedNegative =
      trimmedValue.startsWith("(") && trimmedValue.endsWith(")");
    const normalizedValue = trimmedValue.replace(/[()$,]/g, "");

    const amount = Number(normalizedValue) || 0;

    return isParenthesizedNegative ? -amount : amount;
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
      "0",
    )}`;
  }
}
