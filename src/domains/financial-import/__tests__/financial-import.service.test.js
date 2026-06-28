import { describe, expect, test } from "vitest";

import { FinancialImportServiceImpl } from "../financial-import.service";

describe("FinancialImportService", () => {
  test("routes CSV imports to the selected source service", () => {
    const service = new FinancialImportServiceImpl({
      importers: {
        rentec: {
          importCsv({ csv, chartOfAccounts }) {
            return {
              source: "rentec",
              csv,
              chartOfAccounts,
            };
          },
        },
      },
    });

    const chartOfAccounts = {};

    expect(
      service.importCsv({
        source: "rentec",
        csv: "csv-content",
        chartOfAccounts,
      }),
    ).toEqual({
      source: "rentec",
      csv: "csv-content",
      chartOfAccounts,
    });
  });

  test("routes row imports to sources that support rows", () => {
    const service = new FinancialImportServiceImpl({
      importers: {
        quickbooks: {
          importRows({ rows, chartOfAccounts }) {
            return {
              source: "quickbooks",
              rows,
              chartOfAccounts,
            };
          },
        },
      },
    });

    const rows = [{ id: "qb-1" }];
    const chartOfAccounts = {};

    expect(
      service.importRows({
        source: "quickbooks",
        rows,
        chartOfAccounts,
      }),
    ).toEqual({
      source: "quickbooks",
      rows,
      chartOfAccounts,
    });
  });

  test("rejects unsupported sources", () => {
    const service = new FinancialImportServiceImpl();

    expect(() =>
      service.importCsv({
        source: "unsupported",
        csv: "",
        chartOfAccounts: {},
      }),
    ).toThrow("Unsupported financial import source: unsupported");
  });

  test("rejects row imports for sources that do not support rows", () => {
    const service = new FinancialImportServiceImpl({
      importers: {
        rentec: {
          importCsv() {
            return {};
          },
        },
      },
    });

    expect(() =>
      service.importRows({
        source: "rentec",
        rows: [],
        chartOfAccounts: {},
      }),
    ).toThrow("Financial import source does not support row imports: rentec");
  });
});
