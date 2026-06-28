import { ImportPipeline } from "./ImportPipeline";
import { ImportResult } from "./ImportResult";

function buildDefaultSummary(records) {
  return {
    totalRows: records.length,
    importedRows: records.length,
    skippedRows: 0,
  };
}

export class ProductionImportWorkflow {
  constructor({
    parser,
    semanticResolver,
    pipeline,
    ownerId = null,
    summaryBuilder = buildDefaultSummary,
    sourceName = "Import",
  } = {}) {
    if (!parser) {
      throw new Error("ProductionImportWorkflow requires a parser");
    }

    if (!semanticResolver && !pipeline) {
      throw new Error(
        "ProductionImportWorkflow requires a semantic resolver or pipeline",
      );
    }

    if (typeof summaryBuilder !== "function") {
      throw new Error(
        "ProductionImportWorkflow summaryBuilder must be a function",
      );
    }

    this.parser = parser;
    this.ownerId = ownerId;

    this.pipeline =
      pipeline ??
      new ImportPipeline({
        semanticResolver,
        ownerId: this.ownerId,
      });

    this.summaryBuilder = summaryBuilder;
    this.sourceName = sourceName;

    Object.freeze(this);
  }

  importCsv({ csv, chartOfAccounts }) {
    if (typeof csv !== "string") {
      throw new Error(`${this.sourceName} CSV is required`);
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    if (typeof this.parser.parseCsv !== "function") {
      throw new Error(`${this.sourceName} parser must support parseCsv`);
    }

    return this.importRecords({
      records: this.parser.parseCsv(csv),
      chartOfAccounts,
    });
  }

  importRows({ rows, chartOfAccounts }) {
    if (!Array.isArray(rows)) {
      throw new Error(`${this.sourceName} rows are required`);
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    if (typeof this.parser.parse !== "function") {
      throw new Error(`${this.sourceName} parser must support parse`);
    }

    return this.importRecords({
      records: this.parser.parse(rows),
      chartOfAccounts,
    });
  }

  importRecords({ records, chartOfAccounts }) {
    if (!Array.isArray(records)) {
      throw new Error(`${this.sourceName} records are required`);
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    const reports = this.pipeline.buildReports({
      records,
      chartOfAccounts,
    });

    return new ImportResult({
      records,
      summary: this.summaryBuilder(records),
      reports,
    });
  }
}
