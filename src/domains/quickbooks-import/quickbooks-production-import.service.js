import { ImportPipeline, ImportResult } from "../import-pipeline";
import { QuickBooksImportParser } from "./quickbooks-import.parser";
import { quickBooksSemanticResolver } from "./quickbooks-semantic-resolver";

class QuickBooksProductionImportServiceImpl {
  constructor({
    parser = new QuickBooksImportParser(),
    pipeline = new ImportPipeline({
      semanticResolver: quickBooksSemanticResolver,
    }),
  } = {}) {
    this.parser = parser;
    this.pipeline = pipeline;

    Object.freeze(this);
  }


  importCsv({ csv, chartOfAccounts }) {
    if (typeof csv !== "string") {
      throw new Error("QuickBooks CSV is required");
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    const records = this.parser.parseCsv(csv);
    const reports = this.pipeline.buildReports({
      records,
      chartOfAccounts,
    });

    return new ImportResult({
      records,
      summary: {
        totalRows: records.length,
        importedRows: records.length,
        skippedRows: 0,
      },
      reports,
    });
  }

  importRows({ rows, chartOfAccounts }) {
    if (!Array.isArray(rows)) {
      throw new Error("QuickBooks rows are required");
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    const records = this.parser.parse(rows);
    const reports = this.pipeline.buildReports({
      records,
      chartOfAccounts,
    });

    return new ImportResult({
      records,
      summary: {
        totalRows: records.length,
        importedRows: records.length,
        skippedRows: 0,
      },
      reports,
    });
  }
}

export const QuickBooksProductionImportService =
  new QuickBooksProductionImportServiceImpl();

export { QuickBooksProductionImportServiceImpl };
