import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedFinancialApplication: vi.fn(),
  traceReportLine: vi.fn(),
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
  return new Request("http://localhost/api/financial/trace", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function configureAuthenticatedRequest() {
  mocks.createAuthenticatedFinancialApplication.mockResolvedValue({
    getFinancialApplicationSuite: vi.fn().mockResolvedValue({
      explainabilityApplication: {
        traceReportLine: mocks.traceReportLine,
      },
    }),
  });
}

describe("POST /api/financial/trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.traceReportLine.mockReturnValue({
      source: "ledger",
    });
  });

  it("returns an authenticated trace", async () => {
    configureAuthenticatedRequest();

    const response = await POST(request({
      reportLine: { id: "line-1" },
      ledgerContext: { period: "current" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        trace: { source: "ledger" },
      },
    });
  });

  it("validates input before authentication", async () => {
    const response = await POST(request({}));

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
      reportLine: { id: "line-1" },
    }));

    expect(result).toBe(response);
    expect(mocks.traceReportLine).not.toHaveBeenCalled();
  });
});
