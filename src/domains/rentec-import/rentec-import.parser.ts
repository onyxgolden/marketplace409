import type { RentecImportRecord } from "./rentec-import.types";

type RentecCsvRow = Record<string, string>;

export class RentecImportParser {
  parseCsv(csv: string): RentecImportRecord[] {
    return this.parse(this.parseCsvRows(csv));
  }

  parse(rows: RentecCsvRow[]): RentecImportRecord[] {
    const records: RentecImportRecord[] = [];

    rows.forEach((row, rowIndex) => {
      const property = (row.PROPERTY ?? "").trim();
      const description = (row.DESCRIPTION ?? "").trim();

      if (!property || property === "Totals") {
        return;
      }

      const income = this.parseMoney(row.INCOME);
      const expense = this.parseMoney(row.EXPENSE);
      const transactionDate = this.normalizeDate(row.DATE);

      // An unparseable or structurally implausible date (see normalizeDate) must never silently
      // enter the ledger under a fabricated year -- skip the whole row rather than writing an
      // income/expense transaction with a date nobody actually confirmed.
      if (!transactionDate) {
        return;
      }

      if (income > 0) {
        records.push({
          date: transactionDate,
          property,
          description,
          type: "income",
          amount: income,
          sourceRecordId: this.buildSourceRecordId({
            transactionDate,
            rowIndex,
            recordKind: "income",
          }),
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
          sourceRecordId: this.buildSourceRecordId({
            transactionDate,
            rowIndex,
            recordKind: "expense",
          }),
          sourceCategory: description,
          rawRow: row,
        });
      }
    });

    return records;
  }

  private buildSourceRecordId({
    transactionDate,
    rowIndex,
    recordKind,
  }: {
    transactionDate: string;
    rowIndex: number;
    recordKind: "income" | "expense";
  }): string {
    return `rentec-${transactionDate}-${rowIndex}-${recordKind}`;
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

    const normalizedValue = value.trim().replace(/[()$,]/g, "");

    return Math.abs(Number(normalizedValue) || 0);
  }

  // Real US rental/property accounting does not predate 1900 -- a source year numerically below
  // that is not a legitimate (if unusual) historical date, it is corrupted input, most plausibly a
  // truncated 2-digit year that arrived already zero-padded to 4 characters upstream of this parser
  // (e.g. "15" losing its leading digit down to "5", then padded to "0005" by whatever produced the
  // CSV, before this code ever sees it -- padStart on the *parser's own* side cannot undo that, since
  // by the time it runs the string is already 4 characters long and indistinguishable in shape from
  // a genuine year).
  private static readonly MIN_PLAUSIBLE_YEAR = 1900;

  // Real production data reproduced exactly this failure: a raw DATE of "11/17/0005" parsed clean
  // under the old (pad-only) logic, landed in financial_events as 2005-11-17 (a well-known legacy
  // JS Date-parsing quirk elsewhere in this pipeline coincidentally "corrected" the stored date but
  // not the record's own id, which still reads "0005"), and silently distorted 20 years of the All
  // Time chart's start year before anyone noticed. This rejects any date whose parsed year falls
  // below the floor instead of accepting it at face value.
  private normalizeDate(value?: string): string {
    if (!value) {
      return "";
    }

    const [month, day, year] = value.split("/");

    if (!month || !day || !year) {
      return value;
    }

    if (Number(year) < RentecImportParser.MIN_PLAUSIBLE_YEAR) {
      return "";
    }

    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(
      2,
      "0",
    )}`;
  }

  private inferExpenseType(description: string): "expense" | "asset_purchase" {
    if (description.toLowerCase().includes("purchase price")) {
      return "asset_purchase";
    }

    return "expense";
  }
}
