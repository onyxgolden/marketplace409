import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedFinancialApplication: vi.fn(),
  explainReportLine: vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedFinancialApplication",
  () => ({
    createAuthenticatedFinancialApplication:
      mocks.createAuthenticatedFinancialApplication,
  }),
);

import { POST } from "./route";

function request(body) {
  return new Request("http://localhost/api/financial/explain", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function configureAuthenticatedRequest() {
  mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
    getFinancialApplicationSuite: vi.fn().mockResolvedValue({
      explainabilityApplication: {
        explainReportLine: mocks.explainReportLine,
      },
    }),
  });
}

describe("POST /api/financial/explain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.explainReportLine.mockReturnValue("Explanation");
  });

  it("returns an authenticated explanation", async () => {
    configureAuthenticatedRequest();

    const response = await POST(request({
      query: "Why?",
      reportLine: { id: "line-1" },
      ledgerContext: { period: "current" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { explanation: "Explanation" },
    });
  });

  it("validates input before authentication", async () => {
    const response = await POST(request({ query: "" }));

    expect(response.status).toBe(400);
    expect(
      mocks.createAuthenticatedFinancialApplication,
    ).not.toHaveBeenCalled();
  });

  it("returns the authentication response", async () => {
    const response = Response.json(
      { error: "Authenticated owner id is required." },
      { status: 401 },
    );

    mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
      response,
    });

    const result = await POST(request({
      query: "Why?",
      reportLine: { id: "line-1" },
    }));

    expect(result).toBe(response);
    expect(mocks.explainReportLine).not.toHaveBeenCalled();
  });
});
