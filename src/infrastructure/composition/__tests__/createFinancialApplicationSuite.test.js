import { createFinancialApplicationSuite } from "../createFinancialApplicationSuite.js";
import {
  FinancialDashboardIntelligenceApplication,
  FinancialExplainabilityApplication,
  FinancialIntelligenceApplication,
} from "../../../application/financial";

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
});
