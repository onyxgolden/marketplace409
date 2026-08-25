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
    expect(result.portfolio).toBeNull();
    expect(result.properties).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.transactions).toEqual([]);

    expect(result.statusItems[0]).toEqual({
      label: "Financial Workspace",
      detail: "Repository-backed financial workspace read model is active.",
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
          provider: "financial-events",
          snapshotStatus: "repository-backed",
          phase: "16.2",
        },
        balanceSheetLines: [],
      },
      reports: {
        portfolio: {
          income: 1500,
          expenses: 250,
          noi: 1250,
          cashFlow: 1250,
          transactionCount: 2,
        },
        properties: [
          {
            propertyId: "170-john",
            income: 1500,
            expenses: 250,
            noi: 1250,
            cashFlow: 1250,
            transactionCount: 2,
          },
        ],
        categories: [
          {
            category: "rental_income",
            income: 1500,
            expenses: 0,
            netAmount: 1500,
            transactionCount: 1,
          },
        ],
        transactions: [
          {
            id: "event-1",
            propertyId: "170-john",
            eventDate: "2026-01-01",
            description: "January Rent",
            amount: 1500,
            transactionKind: "income",
            category: "rental_income",
            sourceSystem: "rentec",
          },
        ],
      },
      operationsPlan: {
        focus: "Protect cash",
      },
    });

    expect(result.loadState).toBe("ready");
    expect(result.kpis).toEqual({ equity: 100000 });
    expect(result.operationsPlan).toEqual({
      focus: "Protect cash",
    });
    expect(result.portfolio).toEqual({
      income: 1500,
      expenses: 250,
      noi: 1250,
      cashFlow: 1250,
      transactionCount: 2,
    });
    expect(result.properties).toHaveLength(1);
    expect(result.properties[0].propertyId).toBe(
      "170-john",
    );
    expect(result.categories).toHaveLength(1);
    expect(result.transactions).toHaveLength(1);

    expect(result.statusItems).toEqual([
      {
        label: "Financial Workspace",
        detail: "Repository-backed financial workspace read model is active.",
        value: "online",
      },
      {
        label: "Data Provider",
        detail: "Provider abstraction is active for Phase 7.3.",
        value: "financial-events",
      },
      {
        label: "Snapshot Status",
        detail: "Live persistence and sync history are deferred.",
        value: "repository-backed",
      },
    ]);
    expect(result.activities[1]).toMatchObject({
      id: "provider-active",
      timestamp: "Phase 16.2",
    });
  });

  it("loads the repository-backed financial read model and operations through an injected fetcher", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            financial: {
              type: "financial-dashboard",
              dashboard: {
                kpis: {
                  cash: null,
                  profit: 280000,
                },
                metadata: {
                  provider: "financial-events",
                  snapshotStatus:
                    "repository-backed",
                  phase: "16.2",
                },
                balanceSheetLines: [],
              },
            },
            business: {
              type: "business-dashboard",
              reports: {
                portfolio: {
                  income: 300000,
                  expenses: 20000,
                  noi: 280000,
                  cashFlow: 280000,
                  transactionCount: 12,
                },
                properties: [
                  {
                    propertyId: "170-john",
                    income: 300000,
                    expenses: 20000,
                    noi: 280000,
                    cashFlow: 280000,
                    transactionCount: 12,
                  },
                ],
                categories: [],
                transactions: [],
              },
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
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            business: {
              type: "business-dashboard",
              reports: {
                transactions: [
                  { id: "t1", businessScope: "business" },
                  { id: "t2", businessScope: "personal" },
                ],
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          accounts: [{ id: "acct-1", name: "Business Savings", type: "depository" }],
        }),
      });

    const result = await ForgeFinancialDashboardApplication.load({ fetcher });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/financial/read-models?financial=true&business=true",
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/financial/operations",
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/financial/read-models?business=true&scope=all",
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      "/api/financial/accounts",
    );
    expect(result.loadState).toBe("ready");
    expect(result.kpis.profit).toBe(280000);
    expect(result.kpis.cash).toBeNull();
    expect(result.portfolio.noi).toBe(280000);
    expect(result.properties).toHaveLength(1);
    expect(result.operationsPlan.focus).toBe(
      "Keep monitoring",
    );
    expect(result.allScopeTransactions).toHaveLength(2);
    expect(result.accounts).toEqual([
      { id: "acct-1", name: "Business Savings", type: "depository" },
    ]);
  });

  it("builds an error model when loading fails", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      json: async () => ({
        success: false,
        error: "Read model unavailable.",
      }),
    });

    const result = await ForgeFinancialDashboardApplication.load({ fetcher });

    expect(result.loadState).toBe("error");
    expect(result.error).toBe("Read model unavailable.");
    expect(result.statusItems[0].value).toBe("error");
  });
});
