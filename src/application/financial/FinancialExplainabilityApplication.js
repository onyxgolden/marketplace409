export class FinancialExplainabilityApplication {
  constructor({ traceExplorerService, traceQueryService }) {
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
