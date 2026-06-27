import { describe, expect, test } from "vitest";
import { QuickBooksImportParser } from "../quickbooks-import.parser";

describe("QuickBooksImportParser", () => {
  test("parses rows with common QuickBooks headers", () => {
    const parser = new QuickBooksImportParser();

    const records = parser.parse([
      {
        Date: "01/01/2026",
        Description: "Rental Income",
        Amount: "1500.00",
        Account: "Rental Income",
        Category: "Rental Income",
        Class: "170 John",
        "Transaction ID": "qb-1",
      },
      {
        Date: "01/02/2026",
        Memo: "Repairs",
        Amount: "-250.00",
        Account: "Repairs Expense",
        Category: "Repairs",
        Class: "170 John",
        "Transaction ID": "qb-2",
      },
    ]);

    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      date: "2026-01-01",
      description: "Rental Income",
      amount: 1500,
      property: "170 John",
      sourceRecordId: "qb-1",
    });

    expect(records[1]).toMatchObject({
      date: "2026-01-02",
      description: "Repairs",
      amount: -250,
      property: "170 John",
      sourceRecordId: "qb-2",
    });
  });
});

test("parses quoted commas inside descriptions", () => {
  const parser = new QuickBooksImportParser();

  const records = parser.parseCsv(
`Date,Description,Amount,Account,Category,Class,Transaction ID
01/03/2026,"Repair, Plumbing",125.00,Repairs Expense,Repairs,170 John,qb-3`
  );

  expect(records).toHaveLength(1);

  expect(records[0]).toMatchObject({
    description: "Repair, Plumbing",
    amount: 125,
    property: "170 John",
    sourceRecordId: "qb-3",
  });
});

test("parses parenthesized negative amounts", () => {
  const parser = new QuickBooksImportParser();

  const records = parser.parseCsv(
`Date,Description,Amount,Account,Category,Class,Transaction ID
01/04/2026,Repairs,"($250.00)",Repairs Expense,Repairs,170 John,qb-4`
  );

  expect(records).toHaveLength(1);

  expect(records[0]).toMatchObject({
    amount: -250,
  });
});
