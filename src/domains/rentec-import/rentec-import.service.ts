import type {
  RentecImportRecord,
  RentecImportSummary,
} from "./rentec-import.types";

class RentecImportServiceImpl {
  summarize(records: RentecImportRecord[]): RentecImportSummary {
    const totalIncome = records
      .filter((r) => r.type === "income")
      .reduce((sum, r) => sum + r.amount, 0);

    const totalExpenses = records
      .filter((r) => r.type === "expense")
      .reduce((sum, r) => sum + r.amount, 0);

    const properties = [...new Set(records.map((r) => r.property))].sort();

    return {
      totalRows: records.length,
      importedRows: records.length,
      skippedRows: 0,
      totalIncome,
      totalExpenses,
      properties,
    };
  }
}

export const RentecImportService = new RentecImportServiceImpl();
