import { describe, expect, test } from "vitest";
import { RentecImportParser } from "../rentec-import.parser";

describe("RentecImportParser", () => {
  test("parses income and expense rows and skips totals", () => {
    const parser = new RentecImportParser();

    const records = parser.parse([
      {
        DATE: "2026-01-01",
        PROPERTY: "170 John",
        DESCRIPTION: "Rental Income",
        INCOME: "1500.00",
        EXPENSE: "",
      },
      {
        DATE: "2026-01-02",
        PROPERTY: "170 John",
        DESCRIPTION: "Repairs",
        INCOME: "",
        EXPENSE: "250.00",
      },
      {
        DATE: "",
        PROPERTY: "Totals",
        DESCRIPTION: "",
        INCOME: "1500.00",
        EXPENSE: "250.00",
      },
    ]);

    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      property: "170 John",
      type: "income",
      amount: 1500,
    });

    expect(records[1]).toMatchObject({
      property: "170 John",
      type: "expense",
      amount: 250,
    });
  });
});
