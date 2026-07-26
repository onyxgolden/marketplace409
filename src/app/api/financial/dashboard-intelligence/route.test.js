import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedForgeApplication: vi.fn(),
  buildCanonicalIntelligenceContext: vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedForgeApplication",
  () => ({
    createAuthenticatedForgeApplication:
      mocks.createAuthenticatedForgeApplication,
  }),
);

import { POST } from "./route";

function configureAuthenticatedRequest() {
  mocks.createAuthenticatedForgeApplication.mockResolvedValue({
    user: {
      id: "owner-1",
    },
    getForgeApplicationSuite: vi.fn().mockResolvedValue({
      canonicalIntelligenceContextBuilder: {
        build:
          mocks.buildCanonicalIntelligenceContext,
      },
    }),
  });
}

describe("POST /api/financial/dashboard-intelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildCanonicalIntelligenceContext.mockResolvedValue({
      financial: {},
      connections: {},
      provenance: {},
    });
  });

  it("returns authenticated dashboard intelligence", async () => {
    configureAuthenticatedRequest();

    const response = await POST(
      new Request("http://localhost/api/financial/dashboard-intelligence", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        financial: {},
        connections: {},
        provenance: {},
      },
    });

    expect(mocks.buildCanonicalIntelligenceContext).toHaveBeenCalledWith({
      ownerId: "owner-1",
    });
  });

  it("returns the authentication response", async () => {
    const response = Response.json(
      { error: "Authenticated owner id is required." },
      { status: 401 },
    );

    mocks.createAuthenticatedForgeApplication.mockResolvedValue({
      response,
    });

    const result = await POST(
      new Request("http://localhost/api/financial/dashboard-intelligence", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(result).toBe(response);
    expect(mocks.buildCanonicalIntelligenceContext).not.toHaveBeenCalled();
  });
});
