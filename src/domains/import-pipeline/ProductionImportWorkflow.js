import { ImportPipeline } from "./ImportPipeline";
import { ImportResult } from "./ImportResult";

function buildDefaultSummary(records) {
  return {
    totalRows: records.length,
    importedRows: records.length,
    skippedRows: 0,
  };
}

function buildReviewTransaction(record, index, sourceName) {
  const sourceRecordId =
    record.sourceRecordId ??
    record.rawRow?.ID ??
    record.rawRow?.Id ??
    record.rawRow?.["Transaction ID"] ??
    `${sourceName.toLowerCase()}-${record.date}-${index}`;

  const description = String(record.description ?? "").trim();
  const merchantName = description.length > 0 ? description : null;
  const amount = Number(record.amount ?? record.income ?? record.expense ?? 0);

  return Object.freeze({
    id: `review-transaction:${sourceName}:${sourceRecordId}`,
    financialAccountId: `review-account:${sourceName}`,
    connectionId: `review-connection:${sourceName}`,
    provider: sourceName.toLowerCase(),
    providerTransactionId: String(sourceRecordId),
    providerAccountId: `review-provider-account:${sourceName}`,
    amountCents: Math.round(amount * 100),
    currencyCode: "USD",
    date: String(record.date ?? ""),
    description,
    merchantName,
    category: Object.freeze(
      [record.sourceCategory ?? record.category ?? record.type].filter(
        (value) => typeof value === "string" && value.length > 0,
      ),
    ),
    pending: false,
    raw: record.rawRow ?? null,
    createdAt: new Date(0).toISOString(),
  });
}

function buildTransactionReview(records, sourceName) {
  return records.map((record, index) => {
    const resolvedProperty = record.resolvedProperty ?? {
      name: record.property ?? "Unknown Property",
    };

    return Object.freeze({
      record,
      transaction: buildReviewTransaction(record, index, sourceName),
      resolvedProperty,
      needsAssignment:
        !record.property ||
        record.property === "Unknown Property" ||
        resolvedProperty?.name === "Unknown Property",
    });
  });
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
      transactionReview: buildTransactionReview(records, this.sourceName),
    });
  }
}
