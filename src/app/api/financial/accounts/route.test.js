import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { GET, POST } from "./route";

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

function request(body) {
  return new Request("http://localhost/api/financial/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/financial/accounts", () => {
  let database;
  let inserted;

  beforeEach(() => {
    vi.clearAllMocks();
    inserted = [];
    database = {
      from: vi.fn((table) => ({
        insert: vi.fn((row) => {
          inserted.push({ table, row });
          return Promise.resolve({ error: null });
        }),
      })),
    };
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: database });
  });

  it("creates a new loan account and its opening balance for the authenticated owner", async () => {
    const response = await POST(request({ name: "Share Lane Mortgage", type: "loan", currentBalanceCents: 17601260, asOf: "2026-09-01" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.accountId).toMatch(/^financial_account_manual_/);

    expect(inserted).toHaveLength(2);
    expect(inserted[0].table).toBe("financial_accounts");
    expect(inserted[0].row).toMatchObject({
      owner_id: "owner_1", name: "Share Lane Mortgage", type: "loan", active: true, currency_code: "USD",
    });
    expect(inserted[1].table).toBe("account_balances");
    expect(inserted[1].row).toMatchObject({
      owner_id: "owner_1", financial_account_id: inserted[0].row.id, provider: "manual",
      current_balance_cents: 17601260, as_of: "2026-09-01",
    });
  });

  it("rejects an unsupported account type", async () => {
    const response = await POST(request({ name: "X", type: "investment", currentBalanceCents: 100, asOf: "2026-09-01" }));
    expect(response.status).toBe(400);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("rejects a missing name", async () => {
    const response = await POST(request({ type: "loan", currentBalanceCents: 100, asOf: "2026-09-01" }));
    expect(response.status).toBe(400);
  });

  it("rejects a negative or fractional balance", async () => {
    expect((await POST(request({ name: "X", type: "loan", currentBalanceCents: -100, asOf: "2026-09-01" }))).status).toBe(400);
    expect((await POST(request({ name: "X", type: "loan", currentBalanceCents: 12.5, asOf: "2026-09-01" }))).status).toBe(400);
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValueOnce({ response: new Response("unauthorized", { status: 401 }) });
    const response = await POST(request({ name: "X", type: "loan", currentBalanceCents: 100 }));
    expect(response.status).toBe(401);
  });

  it("returns a 500 when the account insert fails", async () => {
    database.from = vi.fn(() => ({ insert: vi.fn(() => Promise.resolve({ error: { message: "boom" } })) }));
    const response = await POST(request({ name: "X", type: "loan", currentBalanceCents: 100, asOf: "2026-09-01" }));
    expect(response.status).toBe(500);
  });
});
