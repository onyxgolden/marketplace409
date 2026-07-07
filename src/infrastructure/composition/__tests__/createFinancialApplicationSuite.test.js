import { createFinancialApplicationSuite } from "../createFinancialApplicationSuite.js";
import {
  FinancialDashboardIntelligenceApplication,
  FinancialExplainabilityApplication,
  FinancialIntelligenceApplication,
  FinancialOperationsApplication,
} from "../../../application/financial";

import { FinancialOperationsService } from "../../../domains/financial-operations";

describe("createFinancialApplicationSuite", () => {
  test("wires financial explainability application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.explainabilityApplication).toBeInstanceOf(
      FinancialExplainabilityApplication,
    );
  });

  test("allows explainability application injection", async () => {
    const explainabilityApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      explainabilityApplication,
    });

    expect(suite.explainabilityApplication).toBe(
      explainabilityApplication,
    );
  });

  test("wires dashboard intelligence application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.dashboardIntelligenceApplication).toBeInstanceOf(
      FinancialDashboardIntelligenceApplication,
    );
  });

  test("allows dashboard intelligence application injection", async () => {
    const dashboardIntelligenceApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      dashboardIntelligenceApplication,
    });

    expect(suite.dashboardIntelligenceApplication).toBe(
      dashboardIntelligenceApplication,
    );
  });

  test("wires financial intelligence application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialIntelligenceApplication).toBeInstanceOf(
      FinancialIntelligenceApplication,
    );
  });

  test("injects financial intelligence domain services from the composition root", async () => {
    const trendAnalysisService = {};
    const scenarioModelingService = {};
    const forecastService = {};
    const recommendationService = {};
    const planningService = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      trendAnalysisService,
      scenarioModelingService,
      forecastService,
      recommendationService,
      planningService,
    });

    expect(suite.financialIntelligenceApplication.trendAnalysisService).toBe(
      trendAnalysisService,
    );
    expect(suite.financialIntelligenceApplication.scenarioModelingService).toBe(
      scenarioModelingService,
    );
    expect(suite.financialIntelligenceApplication.forecastService).toBe(
      forecastService,
    );
    expect(suite.financialIntelligenceApplication.recommendationService).toBe(
      recommendationService,
    );
    expect(suite.financialIntelligenceApplication.planningService).toBe(
      planningService,
    );
  });

  test("allows financial intelligence application injection", async () => {
    const financialIntelligenceApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialIntelligenceApplication,
    });

    expect(suite.financialIntelligenceApplication).toBe(
      financialIntelligenceApplication,
    );
  });
  test("wires financial operations application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialOperationsApplication).toBeInstanceOf(
      FinancialOperationsApplication,
    );
  });

  test("wires financial operations service into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialOperationsService).toBeInstanceOf(
      FinancialOperationsService,
    );
    expect(suite.financialOperationsApplication.financialOperationsService).toBe(
      suite.financialOperationsService,
    );
  });

  test("allows financial operations service injection", async () => {
    const financialOperationsService = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialOperationsService,
    });

    expect(suite.financialOperationsService).toBe(financialOperationsService);
    expect(suite.financialOperationsApplication.financialOperationsService).toBe(
      financialOperationsService,
    );
  });

  test("allows financial operations application injection", async () => {
    const financialOperationsApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialOperationsApplication,
    });

    expect(suite.financialOperationsApplication).toBe(
      financialOperationsApplication,
    );
  });
  test("builds default applications with usable financial data", async () => {
    const suite = await createFinancialApplicationSuite();

    const snapshot =
      await suite.snapshotApplication.captureDashboardSnapshot();

    const operations =
      suite.financialOperationsApplication.buildFinancialOperations();

    expect(snapshot.dashboard).toBeDefined();
    expect(operations.type).toBe("financial-operations");
    expect(Array.isArray(operations.actions)).toBe(true);
  });
});
