import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateAuthenticatedForgeApplication = vi.fn();

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: (...args) =>
    mockCreateAuthenticatedForgeApplication(...args),
}));

const { GET } = await import("./route.js");

function buildTransaction(index) {
  return Object.freeze({
    id: `event-${index}`,
    propertyId: "170-john",
    eventDate: "2026-01-01",
    description: "Rental Income",
    amount: 1500,
    transactionKind: "income",
    category: "rental_income",
    affectsNOI: true,
    capitalized: false,
    sourceSystem: "rentec",
    sourceRecordId: `rentec-${index}`,
    businessScope: "business",
    financialAccountId: null,
  });
}

function fakeSuite({ transactions }) {
  return {
    financialWorkspaceQueryService: {
      buildWorkspace: vi.fn(async (ownerId, { scope } = {}) => {
        if (ownerId !== "owner-1") {
          throw new Error("wrong owner");
        }

        if (scope !== "business") {
          throw new Error(`unexpected scope ${scope}`);
        }

        return Object.freeze({ transactions });
      }),
    },
  };
}

describe("GET /api/forge/dashboard/transactions", () => {
  beforeEach(() => {
    mockCreateAuthenticatedForgeApplication.mockReset();
  });

  it("returns the first page of the full business-scope history", async () => {
    const transactions = Object.freeze([
      buildTransaction(0),
      buildTransaction(1),
      buildTransaction(2),
    ]);

    mockCreateAuthenticatedForgeApplication.mockResolvedValue({
      supabaseClient: {},
      user: { id: "owner-1" },
      effectiveOwnerId: "owner-1",
      getForgeApplicationSuite: async () =>
        fakeSuite({ transactions }),
    });

    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=1&pageSize=2",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(payload.transactions).toHaveLength(2);
    expect(payload.totalCount).toBe(3);
    expect(payload.totalPages).toBe(2);
    expect(payload.complete).toBe(false);
    expect(payload.transactionsStatus).toBe("loaded");
  });

  it("returns the final page marked complete", async () => {
    const transactions = Object.freeze([
      buildTransaction(0),
      buildTransaction(1),
      buildTransaction(2),
    ]);

    mockCreateAuthenticatedForgeApplication.mockResolvedValue({
      supabaseClient: {},
      user: { id: "owner-1" },
      effectiveOwnerId: "owner-1",
      getForgeApplicationSuite: async () =>
        fakeSuite({ transactions }),
    });

    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=2&pageSize=2",
      ),
    );
    const payload = await response.json();

    expect(payload.transactions).toHaveLength(1);
    expect(payload.complete).toBe(true);
  });

  it("passes the factory's 401/403 response through untouched", async () => {
    const denied = new Response(
      JSON.stringify({ error: "Authenticated owner id is required." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );

    mockCreateAuthenticatedForgeApplication.mockResolvedValue({
      response: denied,
    });

    const response = await GET(
      new Request("http://localhost/api/forge/dashboard/transactions"),
    );

    expect(response.status).toBe(401);
    expect(
      mockCreateAuthenticatedForgeApplication,
    ).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for an invalid page, not an empty history", async () => {
    mockCreateAuthenticatedForgeApplication.mockResolvedValue({
      supabaseClient: {},
      user: { id: "owner-1" },
      effectiveOwnerId: "owner-1",
      getForgeApplicationSuite: async () =>
        fakeSuite({ transactions: Object.freeze([]) }),
    });

    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=0",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/positive integer/);
  });

  it("returns 500 -- never a fabricated empty history -- when the workspace build fails", async () => {
    mockCreateAuthenticatedForgeApplication.mockResolvedValue({
      supabaseClient: {},
      user: { id: "owner-1" },
      effectiveOwnerId: "owner-1",
      getForgeApplicationSuite: async () => ({
        financialWorkspaceQueryService: {
          buildWorkspace: async () => {
            throw new Error("database unavailable");
          },
        },
      }),
    });

    const response = await GET(
      new Request("http://localhost/api/forge/dashboard/transactions"),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).not.toHaveProperty("transactions");
    expect(payload.error).toBe("Unable to load transaction history.");
  });
});
