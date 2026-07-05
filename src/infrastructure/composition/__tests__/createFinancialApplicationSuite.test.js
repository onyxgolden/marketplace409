import { createFinancialApplicationSuite } from "../createFinancialApplicationSuite.js";
import { FinancialExplainabilityApplication } from "../../../application/financial";

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
});
