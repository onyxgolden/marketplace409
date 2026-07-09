import { describe, expect, it, vi } from "vitest";
import { FinancialImportApplication } from "./FinancialImportApplication";

function createCsvFile({
  name = "transactions.csv",
  csv = "date,amount\n2026-01-01,100",
} = {}) {
  return {
    name,
    text: vi.fn(async () => csv),
  };
}

describe("FinancialImportApplication", () => {
  it("returns an empty import model when no file is selected", async () => {
    const application = new FinancialImportApplication();

    const result = await application.importFile({
      file: null,
      source: "rentec",
      ownerId: "owner-1",
    });

    expect(result).toEqual({
      fileName: "",
      result: null,
      error: "",
      ownerId: "owner-1",
      hasFile: false,
    });
  });

  it("imports a CSV file through the financial import service", async () => {
    const importCsv = vi.fn(() => ({ summary: { importedRows: 1 } }));
    const file = createCsvFile();

    const application = new FinancialImportApplication({
      importServiceFactory: vi.fn(() => ({ importCsv })),
      chartOfAccountsFactory: vi.fn(() => "chart"),
    });

    const result = await application.importFile({
      file,
      source: "rentec",
      ownerId: "owner-1",
    });

    expect(file.text).toHaveBeenCalled();
    expect(importCsv).toHaveBeenCalledWith({
      source: "rentec",
      csv: "date,amount\n2026-01-01,100",
      chartOfAccounts: "chart",
    });
    expect(result).toEqual({
      fileName: "transactions.csv",
      result: { summary: { importedRows: 1 } },
      error: "",
      ownerId: "owner-1",
      hasFile: true,
    });
  });

  it("resolves the owner when the current owner is not loaded", async () => {
    const importServiceFactory = vi.fn(() => ({
      importCsv: vi.fn(() => ({ summary: { importedRows: 1 } })),
    }));

    const application = new FinancialImportApplication({
      importServiceFactory,
      chartOfAccountsFactory: vi.fn(() => "chart"),
    });

    const result = await application.importFile({
      file: createCsvFile(),
      source: "rentec",
      ownerId: null,
      resolveOwnerId: vi.fn(async () => "owner-2"),
    });

    expect(importServiceFactory).toHaveBeenCalledWith({
      ownerId: "owner-2",
    });
    expect(result.ownerId).toBe("owner-2");
  });

  it("models import errors without throwing", async () => {
    const application = new FinancialImportApplication({
      importServiceFactory: vi.fn(() => ({
        importCsv: vi.fn(() => {
          throw new Error("Unsupported financial import source: bad-source");
        }),
      })),
      chartOfAccountsFactory: vi.fn(() => "chart"),
    });

    const result = await application.importFile({
      file: createCsvFile(),
      source: "bad-source",
      ownerId: "owner-1",
    });

    expect(result).toEqual({
      fileName: "transactions.csv",
      result: null,
      error: "Unsupported financial import source: bad-source",
      ownerId: "owner-1",
      hasFile: true,
    });
  });
});
