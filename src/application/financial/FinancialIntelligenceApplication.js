export class FinancialIntelligenceApplication {
  constructor({
    readModelApplication,
    trendAnalysisService,
    scenarioModelingService,
    forecastService,
    recommendationService,
    planningService,
  }) {
    if (!readModelApplication) {
      throw new Error(
        "FinancialIntelligenceApplication requires a read model application.",
      );
    }

    if (!trendAnalysisService) {
      throw new Error(
        "FinancialIntelligenceApplication requires a trend analysis service.",
      );
    }

    if (!scenarioModelingService) {
      throw new Error(
        "FinancialIntelligenceApplication requires a scenario modeling service.",
      );
    }

    if (!forecastService) {
      throw new Error(
        "FinancialIntelligenceApplication requires a forecast service.",
      );
    }

    if (!recommendationService) {
      throw new Error(
        "FinancialIntelligenceApplication requires a recommendation service.",
      );
    }

    if (!planningService) {
      throw new Error(
        "FinancialIntelligenceApplication requires a planning service.",
      );
    }

    this.readModelApplication = readModelApplication;
    this.trendAnalysisService = trendAnalysisService;
    this.scenarioModelingService = scenarioModelingService;
    this.forecastService = forecastService;
    this.recommendationService = recommendationService;
    this.planningService = planningService;
  }

  // Slice 3 (load-times): the /forge dashboard passes its already-built
  // summary dashboard in, so this method reuses its KPIs/health instead
  // of calling buildExecutiveSummary/buildKPIModel -- which would run
  // the legacy full-history dashboard build and reintroduce the scan
  // the summary path exists to remove. Callers without a dashboard get
  // today's behavior, unchanged.
  async buildFinancialIntelligence({ dashboard } = {}) {
    const [executiveSummary, kpiModel] =
      dashboard?.dashboard
        ? [
            { health: dashboard.dashboard.health || {} },
            { kpis: dashboard.dashboard.kpis || {} },
          ]
        : await Promise.all([
            this.readModelApplication.buildExecutiveSummary(),
            this.readModelApplication.buildKPIModel(),
          ]);

    const kpis = kpiModel.kpis || {};
    const health = executiveSummary.health || {};

    return Object.freeze({
      type: "financial-intelligence",
      trendAnalysis: this.trendAnalysisService.analyze(kpis),
      scenarioModeling: this.scenarioModelingService.model(kpis),
      forecast: this.forecastService.forecast(kpis),
      recommendations: this.recommendationService.recommend(kpis, health),
      planningAssistance: this.planningService.buildPlan(kpis, health),
      source: Object.freeze({
        authority: "financial-event-repository-backed-read-models",
        mutableLedgerState: false,
        aiGenerated: false,
      }),
    });
  }
}

Object.freeze(FinancialIntelligenceApplication);
