import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedFinancialApplication: vi.fn(),
  buildDashboardIntelligence: vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedFinancialApplication",
  () => ({
    createAuthenticatedFinancialApplication:
      mocks.createAuthenticatedFinancialApplication,
  }),
);

import { POST } from "./route";

function configureAuthenticatedRequest() {
  mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
    getFinancialApplicationSuite: vi.fn().mockResolvedValue({
      dashboardIntelligenceApplication: {
        buildDashboardIntelligence:
          mocks.buildDashboardIntelligence,
      },
    }),
  });
}

describe("POST /api/financial/dashboard-intelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildDashboardIntelligence.mockReturnValue({
      status: "ready",
    });
  });

  it("returns authenticated dashboard intelligence", async () => {
    configureAuthenticatedRequest();

    const response = await POST(
      new Request("http://localhost/api/financial/dashboard-intelligence", {
        method: "POST",
        body: JSON.stringify({
          ledgerContext: { period: "current" },
          assets: [{ id: "asset-1" }],
          liabilities: [{ id: "liability-1" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: "ready" },
    });

    expect(mocks.buildDashboardIntelligence).toHaveBeenCalledWith({
      ledgerContext: { period: "current" },
      assets: [{ id: "asset-1" }],
      liabilities: [{ id: "liability-1" }],
    });
  });

  it("returns the authentication response", async () => {
    const response = Response.json(
      { error: "Authenticated owner id is required." },
      { status: 401 },
    );

    mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
      response,
    });

    const result = await POST(
      new Request("http://localhost/api/financial/dashboard-intelligence", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(result).toBe(response);
    expect(mocks.buildDashboardIntelligence).not.toHaveBeenCalled();
  });
});
