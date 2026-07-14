import { describe, expect, test, vi } from "vitest";

import { FinancialImportServiceImpl } from "../financial-import.service";

describe("FinancialImportService", () => {
  test("routes CSV imports to the selected source service", async () => {
    const service = new FinancialImportServiceImpl({
      importers: {
        rentec: {
          importCsv({ csv, chartOfAccounts }) {
            return {
              source: "rentec",
              csv,
              chartOfAccounts,
              financialEvents: [],
            };
          },
        },
      },
    });

    const chartOfAccounts = {};

    await expect(
      service.importCsv({
        source: "rentec",
        csv: "csv-content",
        chartOfAccounts,
      }),
    ).resolves.toEqual({
      source: "rentec",
      csv: "csv-content",
      chartOfAccounts,
      financialEvents: [],
    });
  });

  test("persists canonical financial events produced by CSV imports", async () => {
    const financialEvents = [
      {
        id: "event-1",
        owner_id: "owner-1",
      },
    ];
    const saveMany = vi.fn(async (events) => events);

    const service = new FinancialImportServiceImpl({
      financialEventRepository: { saveMany },
      importers: {
        rentec: {
          importCsv: vi.fn(async () => ({
            summary: { importedRows: 1 },
            financialEvents,
          })),
        },
      },
    });

    const result = await service.importCsv({
      source: "rentec",
      csv: "csv-content",
      chartOfAccounts: {},
    });

    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(saveMany).toHaveBeenCalledWith(financialEvents);
    expect(result).toEqual({
      summary: { importedRows: 1 },
      financialEvents,
    });
  });

  test("routes row imports to sources that support rows", async () => {
    const service = new FinancialImportServiceImpl({
      importers: {
        quickbooks: {
          importRows({ rows, chartOfAccounts }) {
            return {
              source: "quickbooks",
              rows,
              chartOfAccounts,
              financialEvents: [],
            };
          },
        },
      },
    });

    const rows = [{ id: "qb-1" }];
    const chartOfAccounts = {};

    await expect(
      service.importRows({
        source: "quickbooks",
        rows,
        chartOfAccounts,
      }),
    ).resolves.toEqual({
      source: "quickbooks",
      rows,
      chartOfAccounts,
      financialEvents: [],
    });
  });

  test("persists canonical financial events produced by row imports", async () => {
    const financialEvents = [
      {
        id: "event-2",
        owner_id: "owner-1",
      },
    ];
    const saveMany = vi.fn(async (events) => events);

    const service = new FinancialImportServiceImpl({
      financialEventRepository: { saveMany },
      importers: {
        quickbooks: {
          importRows: vi.fn(async () => ({
            summary: { importedRows: 1 },
            financialEvents,
          })),
        },
      },
    });

    const result = await service.importRows({
      source: "quickbooks",
      rows: [{ id: "qb-1" }],
      chartOfAccounts: {},
    });

    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(saveMany).toHaveBeenCalledWith(financialEvents);
    expect(result).toEqual({
      summary: { importedRows: 1 },
      financialEvents,
    });
  });

  test("does not require persistence when no repository is configured", async () => {
    const result = {
      summary: { importedRows: 1 },
      financialEvents: [{ id: "event-1" }],
    };

    const service = new FinancialImportServiceImpl({
      importers: {
        rentec: {
          importCsv: vi.fn(async () => result),
        },
      },
    });

    await expect(
      service.importCsv({
        source: "rentec",
        csv: "csv-content",
        chartOfAccounts: {},
      }),
    ).resolves.toBe(result);
  });

  test("does not return the import result when persistence fails", async () => {
    const persistenceError = new Error("Unable to persist financial events");

    const service = new FinancialImportServiceImpl({
      financialEventRepository: {
        saveMany: vi.fn(async () => {
          throw persistenceError;
        }),
      },
      importers: {
        rentec: {
          importCsv: vi.fn(async () => ({
            summary: { importedRows: 1 },
            financialEvents: [{ id: "event-1" }],
          })),
        },
      },
    });

    await expect(
      service.importCsv({
        source: "rentec",
        csv: "csv-content",
        chartOfAccounts: {},
      }),
    ).rejects.toThrow("Unable to persist financial events");
  });

  test("rejects unsupported sources", async () => {
    const service = new FinancialImportServiceImpl();

    await expect(
      service.importCsv({
        source: "unsupported",
        csv: "",
        chartOfAccounts: {},
      }),
    ).rejects.toThrow("Unsupported financial import source: unsupported");
  });

  test("rejects row imports for sources that do not support rows", async () => {
    const service = new FinancialImportServiceImpl({
      importers: {
        rentec: {
          importCsv() {
            return {};
          },
        },
      },
    });

    await expect(
      service.importRows({
        source: "rentec",
        rows: [],
        chartOfAccounts: {},
      }),
    ).rejects.toThrow(
      "Financial import source does not support row imports: rentec",
    );
  });
});
