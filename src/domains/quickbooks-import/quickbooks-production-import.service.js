import { ProductionImportWorkflow } from "../import-pipeline";
import { QuickBooksImportParser } from "./quickbooks-import.parser";
import { quickBooksSemanticResolver } from "./quickbooks-semantic-resolver";

function summarizeQuickBooksRecords(records) {
  const totalIncome = records
    .filter((record) => record.amount > 0)
    .reduce((sum, record) => sum + record.amount, 0);

  const totalExpenses = records
    .filter((record) => record.amount < 0)
    .reduce((sum, record) => sum + Math.abs(record.amount), 0);

  const properties = [
    ...new Set(
      records
        .map((record) => record.property)
        .filter((property) => typeof property === "string" && property.length > 0),
    ),
  ].sort();

  return {
    totalRows: records.length,
    importedRows: records.length,
    skippedRows: 0,
    totalIncome,
    totalExpenses,
    properties,
  };
}

class QuickBooksProductionImportServiceImpl {
  constructor({
    workflow = new ProductionImportWorkflow({
      parser: new QuickBooksImportParser(),
      semanticResolver: quickBooksSemanticResolver,
      summaryBuilder: summarizeQuickBooksRecords,
      sourceName: "QuickBooks",
    }),
  } = {}) {
    this.workflow = workflow;

    Object.freeze(this);
  }

  importCsv({ csv, chartOfAccounts }) {
    return this.workflow.importCsv({
      csv,
      chartOfAccounts,
    });
  }

  importRows({ rows, chartOfAccounts }) {
    return this.workflow.importRows({
      rows,
      chartOfAccounts,
    });
  }
}

export const QuickBooksProductionImportService =
  new QuickBooksProductionImportServiceImpl();

export { QuickBooksProductionImportServiceImpl };
