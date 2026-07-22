import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedFinancialApplication: vi.fn(),
  buildDashboardReports: vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedFinancialApplication",
  () => ({
    createAuthenticatedFinancialApplication:
      mocks.createAuthenticatedFinancialApplication,
  }),
);

import { GET } from "./route";

describe("GET /api/financial/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns authenticated reports", async () => {
    mocks.buildDashboardReports.mockReturnValue({
      reports: ["income-statement"],
      dashboard: { status: "ready" },
    });

    mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
      getFinancialApplicationSuite: vi.fn().mockResolvedValue({
        reportingApplication: {
          buildDashboardReports: mocks.buildDashboardReports,
        },
      }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        reports: ["income-statement"],
        dashboard: { status: "ready" },
      },
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

    const result = await GET();

    expect(result).toBe(response);
    expect(mocks.buildDashboardReports).not.toHaveBeenCalled();
  });
});
