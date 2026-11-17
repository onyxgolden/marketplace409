import { describe, expect, it, vi } from "vitest";
import { CanonicalIntelligenceContextBuilder } from "./CanonicalIntelligenceContextBuilder.js";

describe("CanonicalIntelligenceContextBuilder", () => {
  it("builds an immutable canonical intelligence context", async () => {
    const financialReadModelApplication = {
      buildDashboard: vi.fn().mockResolvedValue({
        workspace: {
          id: "workspace-1",
        },
        dashboard: {
          assets: [
            {
              name: "Cash",
              value: 100,
            },
          ],
          liabilities: [
            {
              name: "Credit Card",
              value: 25,
            },
          ],
          balanceSheetLines: [
            {
              name: "Cash",
              value: 100,
            },
          ],
        },
      }),
    };

    const financialIntelligenceApplication = {
      buildFinancialIntelligence: vi.fn().mockResolvedValue({
        type: "financial-intelligence",
        recommendations: [
          "Review operating performance.",
        ],
        planningAssistance: {
          priority: "optimize",
          suggestedFocus: "controlled growth",
          summary: "Optimize operations.",
        },
      }),
    };

    const connectionOperationsApplication = {
      buildExecutionIntelligence: vi.fn().mockReturnValue({
        status: "successful",
      }),

      getExecutionHistoryIntelligence: vi.fn().mockResolvedValue({
        totalExecutions: 1,
      }),
    };

    const builder =
      new CanonicalIntelligenceContextBuilder({
        financialReadModelApplication,
        financialIntelligenceApplication,
        connectionOperationsApplication,
      });

    const context = await builder.build({
      ownerId: "owner-1",
      connectionId: "connection-1",
      executionResult: {
        success: true,
      },
    });

    expect(context.type).toBe(
      "canonical-intelligence-context",
    );

    expect(context.financial.workspace).toEqual({
      id: "workspace-1",
    });

    expect(
      context.financial.position.assets,
    ).toEqual([
      {
        name: "Cash",
        value: 100,
      },
    ]);
 
    expect(
      context.financial.position.liabilities,
    ).toEqual([
      {
        name: "Credit Card",
        value: 25,
      },
    ]);
 
    expect(
      context.financial.position.balanceSheetLines,
    ).toEqual([
      {
        name: "Cash",
        value: 100,
      },
    ]);

    expect(
      context.financial.intelligence.type,
    ).toBe("financial-intelligence");

    expect(
      context.connections.execution.status,
    ).toBe("successful");

    expect(
      context.provenance.repositoryBacked,
    ).toBe(true);

    expect(Object.isFrozen(context)).toBe(true);
    expect(
      Object.isFrozen(context.financial),
    ).toBe(true);
  });
});

describe("CanonicalIntelligenceContextBuilder -- dashboard summary override (load-times Slice 3)", () => {
  function buildBuilder() {
    const financialReadModelApplication = {
      buildDashboard: vi.fn().mockResolvedValue({
        workspace: { id: "legacy-workspace" },
        dashboard: { kpis: { revenue: 1 }, health: { label: "Healthy" } },
      }),
    };

    const financialIntelligenceApplication = {
      buildFinancialIntelligence: vi.fn().mockResolvedValue({
        type: "financial-intelligence",
      }),
    };

    const connectionOperationsApplication = {
      buildExecutionIntelligence: vi.fn().mockReturnValue({
        status: "successful",
      }),
      getExecutionHistoryIntelligence: vi.fn().mockResolvedValue({
        totalExecutions: 1,
      }),
    };

    const builder = new CanonicalIntelligenceContextBuilder({
      financialReadModelApplication,
      financialIntelligenceApplication,
      connectionOperationsApplication,
    });

    return {
      builder,
      financialReadModelApplication,
      financialIntelligenceApplication,
    };
  }

  it("uses a supplied summary dashboard and never calls the legacy buildDashboard", async () => {
    const {
      builder,
      financialReadModelApplication,
      financialIntelligenceApplication,
    } = buildBuilder();

    const summaryDashboard = Object.freeze({
      workspace: Object.freeze({
        portfolio: Object.freeze({ income: 1500 }),
        transactionsStatus: "not-loaded",
      }),
      dashboard: Object.freeze({
        assets: [],
        liabilities: [],
        balanceSheetLines: [],
        kpis: Object.freeze({ revenue: 1500 }),
        health: Object.freeze({ label: "Healthy" }),
        metadata: Object.freeze({}),
      }),
    });

    const context = await builder.build({
      ownerId: "owner-1",
      dashboard: summaryDashboard,
    });

    expect(
      financialReadModelApplication.buildDashboard,
    ).not.toHaveBeenCalled();
    expect(
      financialIntelligenceApplication.buildFinancialIntelligence,
    ).toHaveBeenCalledWith({ dashboard: summaryDashboard });
    expect(context.financial.workspace).toEqual(summaryDashboard.workspace);
    expect(context.financial.dashboard).toEqual(summaryDashboard.dashboard);
    expect(context.financial.position.kpis).toEqual({ revenue: 1500 });
  });

  it("without an override, keeps the legacy buildDashboard behavior", async () => {
    const {
      builder,
      financialReadModelApplication,
      financialIntelligenceApplication,
    } = buildBuilder();

    const context = await builder.build({ ownerId: "owner-1" });

    expect(
      financialReadModelApplication.buildDashboard,
    ).toHaveBeenCalledTimes(1);
    expect(
      financialIntelligenceApplication.buildFinancialIntelligence,
    ).toHaveBeenCalledWith({
      dashboard: {
        workspace: { id: "legacy-workspace" },
        dashboard: { kpis: { revenue: 1 }, health: { label: "Healthy" } },
      },
    });
    expect(context.financial.workspace).toEqual({
      id: "legacy-workspace",
    });
  });
});
