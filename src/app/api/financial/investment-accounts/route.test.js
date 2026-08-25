import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { DELETE, GET, PATCH, POST } from "./route";

const accountBody = {
  accountId: "investment_account_1",
  name: "Traditional IRA",
  institutionName: "Vestwell",
  accountType: "ira",
  taxTreatment: "tax_deferred",
  ownershipScope: "personal",
  valueCents: 6569,
  valueDate: "2026-08-25",
  notes: "",
};

function request(method, body) {
  return new Request("http://localhost/api/financial/investment-accounts", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildQuery(rows) {
  const query = { select: () => query, eq: () => query, order: () => query, then: (resolve) => resolve({ data: rows, error: null }) };
  return query;
}

describe("investment account lifecycle route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists active accounts with their latest valuation attached", async () => {
    const supabaseClient = {
      from: vi.fn((table) => {
        if (table === "investment_accounts") {
          return buildQuery([{ id: "investment_account_1", name: "Traditional IRA", institution_name: "Vestwell", account_type: "ira", tax_treatment: "tax_deferred", ownership_scope: "personal", notes: null, active: true }]);
        }
        return buildQuery([{ account_id: "investment_account_1", amount_cents: 6569, effective_date: "2026-08-25", source: "manual" }]);
      }),
    };
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toEqual([{
      id: "investment_account_1", name: "Traditional IRA", institutionName: "Vestwell",
      accountType: "ira", taxTreatment: "tax_deferred", ownershipScope: "personal", notes: null, active: true,
      latestValuation: { amountCents: 6569, effectiveDate: "2026-08-25", source: "manual" },
    }]);
  });

  it("creates an account and its initial valuation atomically", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: "investment_account_1", name: accountBody.name, institution_name: "Vestwell",
      account_type: "ira", tax_treatment: "tax_deferred", ownership_scope: "personal", active: true,
    }, error: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });

    const response = await POST(request("POST", accountBody));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_investment_account_with_valuation", expect.objectContaining({
      p_name: "Traditional IRA",
      p_institution_name: "Vestwell",
      p_account_type: "ira",
      p_tax_treatment: "tax_deferred",
      p_value_cents: 6569,
      p_value_date: "2026-08-25",
      p_value_source: "manual",
    }));
  });

  it("reports a friendly error when the same account name already exists (unique index violation)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });

    const response = await POST(request("POST", accountBody));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("An active investment account with this name already exists.");
  });

  it("rejects an invalid account type before calling the database", async () => {
    const rpc = vi.fn();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await POST(request("POST", { ...accountBody, accountType: "not_a_real_type" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("updates details and records a new manual valuation atomically", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: "investment_account_1", name: accountBody.name, institution_name: "Vestwell",
      account_type: "ira", tax_treatment: "tax_deferred", ownership_scope: "personal", active: true,
    }, error: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });

    const response = await PATCH(request("PATCH", accountBody));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_investment_account_with_valuation", expect.objectContaining({
      p_account_id: "investment_account_1",
      p_value_cents: 6569,
      p_value_date: "2026-08-25",
      p_value_source: "manual",
    }));
  });

  it("soft-retires the account and its canonical net-worth account", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: "investment_account_1", name: accountBody.name, account_type: "ira",
      ownership_scope: "personal", active: false,
    }, error: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });

    const response = await DELETE(request("DELETE", { accountId: "investment_account_1" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("deactivate_investment_account", { p_account_id: "investment_account_1" });
  });

  it("requires authentication for every operation", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await GET()).status).toBe(401);
    expect((await POST(request("POST", accountBody))).status).toBe(401);
    expect((await PATCH(request("PATCH", accountBody))).status).toBe(401);
    expect((await DELETE(request("DELETE", { accountId: "investment_account_1" }))).status).toBe(401);
  });
});
