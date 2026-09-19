import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { DELETE, PUT } from "./route";

const debtAccount = { id: "acct-1", name: "Chase Sapphire", type: "credit", active: true };

function terminal(result = { error: null }) {
  const builder = {
    eq: vi.fn().mockReturnThis(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function buildAuth({ accounts = [debtAccount], upsertResult = { error: null }, deleteResult = { error: null } } = {}) {
  const upsert = vi.fn().mockResolvedValue(upsertResult);
  const supabaseClient = {
    from: vi.fn((table) => {
      if (table !== "debt_terms") throw new Error(`unexpected table ${table}`);
      return { upsert, delete: vi.fn(() => terminal(deleteResult)) };
    }),
  };
  const suite = {
    financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
  };
  mocks.authenticate.mockResolvedValue({
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
    getFinancialApplicationSuite: async () => suite,
  });
  return { supabaseClient, upsert };
}

function putRequest(body) {
  return new Request("http://localhost/api/financial/debt-terms", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/financial/debt-terms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts validated terms for the owner's debt account", async () => {
    const { upsert } = buildAuth();
    const response = await PUT(
      putRequest({ financialAccountId: "acct-1", apr: 24.99, minimumPayment: 75, taxDeductible: true }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: "owner_1",
        financial_account_id: "acct-1",
        apr: 24.99,
        minimum_payment: 75,
        tax_deductible: true,
      }),
      { onConflict: "owner_id,financial_account_id" },
    );
  });

  it("rejects invalid terms without touching the database", async () => {
    const { upsert } = buildAuth();
    for (const body of [
      { financialAccountId: "acct-1", apr: -1, minimumPayment: 75 },
      { financialAccountId: "acct-1", apr: 24.99, minimumPayment: 0 },
      { financialAccountId: "acct-1", apr: "guess", minimumPayment: 75 },
      { apr: 24.99, minimumPayment: 75 },
    ]) {
      expect((await PUT(putRequest(body))).status).toBe(400);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 404 for accounts that are not the owner's debts", async () => {
    buildAuth({ accounts: [{ ...debtAccount, id: "other", type: "depository" }] });
    const response = await PUT(
      putRequest({ financialAccountId: "acct-1", apr: 24.99, minimumPayment: 75 }),
    );
    expect(response.status).toBe(404);
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await PUT(putRequest({ financialAccountId: "a", apr: 1, minimumPayment: 1 }))).status).toBe(401);
  });
});

describe("DELETE /api/financial/debt-terms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the owner's terms row", async () => {
    const { supabaseClient } = buildAuth();
    const response = await DELETE(
      new Request("http://localhost/api/financial/debt-terms?financialAccountId=acct-1", { method: "DELETE" }),
    );
    expect(response.status).toBe(200);
    expect(supabaseClient.from).toHaveBeenCalledWith("debt_terms");
  });

  it("requires the account id", async () => {
    buildAuth();
    expect((await DELETE(new Request("http://localhost/api/financial/debt-terms", { method: "DELETE" }))).status).toBe(400);
  });
});
