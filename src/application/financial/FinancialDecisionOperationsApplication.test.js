import { FinancialDecisionOperationsApplication } from "./FinancialDecisionOperationsApplication.js";

describe("FinancialDecisionOperationsApplication", () => {
  test("builds operations from accepted financial decisions", async () => {
    const financialOperationsApplication = {
      buildFinancialOperationsFromDecisions: vi.fn(
        () => ({
          type: "financial-operations",
          actions: [
            {
              title: "Adjust pricing strategy.",
            },
          ],
        }),
      ),
    };

    const application =
      new FinancialDecisionOperationsApplication({
        financialOperationsApplication,
      });

    const result =
      await application.buildOperations({
        decisions: [
          {
            id: "decision-1",
            status: "accepted",
            selectedAction: "Adjust pricing strategy.",
          },
        ],
      });

    expect(result.type).toBe("financial-operations");

    expect(
      financialOperationsApplication
        .buildFinancialOperationsFromDecisions,
    ).toHaveBeenCalledWith([
      {
        id: "decision-1",
        status: "accepted",
        selectedAction: "Adjust pricing strategy.",
      },
    ]);
  });

  test("requires financial operations application", () => {
    expect(
      () =>
        new FinancialDecisionOperationsApplication({}),
    ).toThrow(
      "FinancialDecisionOperationsApplication requires a financial operations application.",
    );
  });
});
