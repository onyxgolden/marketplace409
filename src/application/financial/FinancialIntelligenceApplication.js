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

  buildFinancialIntelligence() {
    const executiveSummary =
      this.readModelApplication.buildExecutiveSummary();
    const kpiModel = this.readModelApplication.buildKPIModel();

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
        authority: "financial-engine-derived-read-models",
        mutableLedgerState: false,
        aiGenerated: false,
      }),
    });
  }
}

Object.freeze(FinancialIntelligenceApplication);
