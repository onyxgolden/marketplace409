export class FinancialExplainabilityApplication {
  constructor({
    traceExplorerService,
    traceQueryService,
    canonicalExplainabilityProjection,
    generalLedger,
  }) {
    if (!traceExplorerService) {
      throw new Error(
        "FinancialExplainabilityApplication requires a trace explorer service.",
      );
    }

    if (!traceQueryService) {
      throw new Error(
        "FinancialExplainabilityApplication requires a trace query service.",
      );
    }

    this.traceExplorerService = traceExplorerService;
    this.traceQueryService = traceQueryService;
    this.canonicalExplainabilityProjection =
      canonicalExplainabilityProjection;

    this.generalLedger = generalLedger;
  }


  traceCanonicalReportLine(
    reportLine,
    context = {},
  ) {
    const canonicalContext =
      this.canonicalExplainabilityProjection?.project({
        context,
        ledger: this.generalLedger,
      }) || {
        ledgerContext: {},
      };

    return this.traceExplorerService.exploreReportLine(
      reportLine,
      canonicalContext.ledgerContext,
    );
  }

  explainCanonicalReportLine(
    query,
    reportLine,
    context = {},
  ) {
    const canonicalContext =
      this.canonicalExplainabilityProjection?.project({
        context,
        ledger: this.generalLedger,
      }) || {
        ledgerContext: {},
      };

    return this.traceQueryService.ask(
      query,
      reportLine,
      canonicalContext.ledgerContext,
    );
  }

  traceReportLine(reportLine, ledgerContext = {}) {
    return this.traceExplorerService.exploreReportLine(
      reportLine,
      ledgerContext,
    );
  }

  explainReportLine(query, reportLine, ledgerContext = {}) {
    return this.traceQueryService.ask(query, reportLine, ledgerContext);
  }
}

Object.freeze(FinancialExplainabilityApplication);
