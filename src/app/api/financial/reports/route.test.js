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

  it("returns 503 financial-data-unavailable, never demo or zero-dollar values, when reportingApplication is unavailable", async () => {
    mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
      getFinancialApplicationSuite: vi.fn().mockResolvedValue({
        reportingApplication: null,
      }),
    });

    const response = await GET();

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/temporarily unavailable/i);

    // Structural proof this is not a disguised "$0" response: no `data`/`reports`/`dashboard`
    // key exists at all for a caller to misread as a real, zeroed-out financial state.
    expect(body.data).toBeUndefined();
    expect(body.reports).toBeUndefined();
    expect(body.dashboard).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/stack|at Object|node_modules/i);

    expect(mocks.buildDashboardReports).not.toHaveBeenCalled();
  });
});
