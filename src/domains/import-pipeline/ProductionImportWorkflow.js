import { TransactionReviewItem } from "../transaction-review/transaction-review-item";
import { PropertyRecommendationService } from "../transaction-review/property-recommendation.service";
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

function buildTransactionReview(
  records,
  sourceName,
  properties,
  recommendationService,
) {
  return records.map((record, index) => {
    const resolvedProperty = record.resolvedProperty ?? {
      name: record.property ?? "Unknown Property",
    };

    const needsAssignment =
      !record.property ||
      record.property === "Unknown Property" ||
      resolvedProperty?.name === "Unknown Property";

    const transaction = buildReviewTransaction(
      record,
      index,
      sourceName,
    );

    const recommendation = needsAssignment
      ? recommendationService.recommend({
          transaction,
          properties,
        })
      : {
          recommendations: [],
          suggestedProperties: [],
          confidence: 0,
        };

    return new TransactionReviewItem({
      record,
      transaction,
      resolvedProperty,
      needsAssignment,
      confidence: recommendation.confidence,
      recommendations: recommendation.recommendations ?? [],
      suggestedProperties: recommendation.suggestedProperties,
      assignmentStatus:
        needsAssignment &&
        recommendation.suggestedProperties.length > 0
          ? "suggested"
          : undefined,
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
    recommendationService = new PropertyRecommendationService(),
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

    if (typeof recommendationService?.recommend !== "function") {
      throw new Error(
        "ProductionImportWorkflow requires a recommendation service",
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
    this.recommendationService = recommendationService;

    Object.freeze(this);
  }

  importCsv({
    csv,
    chartOfAccounts,
    properties = [],
  }) {
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
      properties,
    });
  }

  importRows({
    rows,
    chartOfAccounts,
    properties = [],
  }) {
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
      properties,
    });
  }

  importRecords({
    records,
    chartOfAccounts,
    properties = [],
  }) {
    if (!Array.isArray(records)) {
      throw new Error(`${this.sourceName} records are required`);
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    if (!Array.isArray(properties)) {
      throw new Error(
        "ProductionImportWorkflow properties must be an array",
      );
    }

    const reports = this.pipeline.buildReports({
      records,
      chartOfAccounts,
    });

    return new ImportResult({
      records,
      summary: this.summaryBuilder(records),
      reports,
      transactionReview: buildTransactionReview(
        records,
        this.sourceName,
        properties,
        this.recommendationService,
      ),
    });
  }
}
