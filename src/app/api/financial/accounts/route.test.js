import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { GET } from "./route";

describe("GET /api/financial/accounts", () => {
  let database;
  let query;

  beforeEach(() => {
    vi.clearAllMocks();
    query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => Promise.resolve({ data: [{ id: "acct-1", name: "Business Savings", type: "depository" }], error: null })),
    };
    database = { from: vi.fn(() => query) };
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: database });
  });

  it("returns the authenticated owner's active financial accounts", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      accounts: [{ id: "acct-1", name: "Business Savings", type: "depository" }],
    });
    expect(database.from).toHaveBeenCalledWith("financial_accounts");
    expect(query.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(query.eq).toHaveBeenCalledWith("active", true);
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValueOnce({ response: new Response("unauthorized", { status: 401 }) });
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns a 500 with the database error message when the query fails", async () => {
    query.order.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});
