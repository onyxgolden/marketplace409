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
