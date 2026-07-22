import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedFinancialApplication: vi.fn(),
  captureDashboardSnapshot: vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedFinancialApplication",
  () => ({
    createAuthenticatedFinancialApplication:
      mocks.createAuthenticatedFinancialApplication,
  }),
);

import { GET } from "./route";

describe("GET /api/financial/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an authenticated snapshot", async () => {
    mocks.captureDashboardSnapshot.mockResolvedValue({
      reports: ["balance-sheet"],
      dashboard: { status: "captured" },
    });

    mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
      getFinancialApplicationSuite: vi.fn().mockResolvedValue({
        snapshotApplication: {
          captureDashboardSnapshot:
            mocks.captureDashboardSnapshot,
        },
      }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        reports: ["balance-sheet"],
        dashboard: { status: "captured" },
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
    expect(mocks.captureDashboardSnapshot).not.toHaveBeenCalled();
  });
});
