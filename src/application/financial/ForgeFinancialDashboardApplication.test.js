import { describe, expect, it, vi } from "vitest";
import { ForgeFinancialDashboardApplication } from "./ForgeFinancialDashboardApplication.js";

describe("ForgeFinancialDashboardApplication", () => {
  it("builds a loading model", () => {
    const result = ForgeFinancialDashboardApplication.buildLoadingModel();

    expect(result.loadState).toBe("loading");
    expect(result.error).toBeNull();
    expect(result.health).toEqual({
      label: "Loading",
      detail: "Financial dashboard data is loading.",
    });
    expect(result.statusItems[0]).toEqual({
      label: "Financial Engine",
      detail: "Reports are generated through the ledger domain engine.",
      value: "loading",
    });
  });

  it("builds a ready model from dashboard and operations data", () => {
    const result = ForgeFinancialDashboardApplication.buildReadyModel({
      dashboard: {
        kpis: { equity: 100000 },
        health: {
          label: "Healthy",
          detail: "Financial position is stable.",
        },
        metadata: {
          provider: "demo",
          snapshotStatus: "current",
          phase: "13.3",
        },
        balanceSheetLines: [{ accountId: "1000", amount: 100000 }],
      },
      operationsPlan: {
        focus: "Protect cash",
      },
    });

    expect(result.loadState).toBe("ready");
    expect(result.kpis).toEqual({ equity: 100000 });
    expect(result.operationsPlan).toEqual({ focus: "Protect cash" });
    expect(result.statusItems).toEqual([
      {
        label: "Financial Engine",
        detail: "Reports are generated through the ledger domain engine.",
        value: "online",
      },
      {
        label: "Data Provider",
        detail: "Provider abstraction is active for Phase 7.3.",
        value: "demo",
      },
      {
        label: "Snapshot Status",
        detail: "Live persistence and sync history are deferred.",
        value: "current",
      },
    ]);
    expect(result.activities[1]).toMatchObject({
      id: "provider-active",
      timestamp: "Phase 13.3",
    });
  });

  it("loads snapshot and operations through an injected fetcher", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            dashboard: {
              kpis: { cash: 280000 },
              metadata: { provider: "fixture" },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            focus: "Keep monitoring",
            priority: "monitor",
          },
        }),
      });

    const result = await ForgeFinancialDashboardApplication.load({ fetcher });

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/financial/snapshot");
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/financial/operations");
    expect(result.loadState).toBe("ready");
    expect(result.kpis.cash).toBe(280000);
    expect(result.operationsPlan.focus).toBe("Keep monitoring");
  });

  it("builds an error model when loading fails", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: "Snapshot unavailable.",
      }),
    });

    const result = await ForgeFinancialDashboardApplication.load({ fetcher });

    expect(result.loadState).toBe("error");
    expect(result.error).toBe("Snapshot unavailable.");
    expect(result.statusItems[0].value).toBe("error");
  });
});
