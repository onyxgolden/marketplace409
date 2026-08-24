import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: mocks.authenticate,
}));
import { GET, POST } from "./route";

function query(data = null, error = null) {
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error })),
    then(resolve) { return Promise.resolve({ data, error }).then(resolve); },
  };
  return chain;
}

function postRequest(body) {
  return new Request("http://localhost/api/rental/property-financial-setup", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
function getRequest(propertyId) {
  return new Request(`http://localhost/api/rental/property-financial-setup?propertyId=${encodeURIComponent(propertyId)}`);
}

describe("GET /api/rental/property-financial-setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing setup and available accounts for a property", async () => {
    const setup = query({ id: "setup_1", property_id: "930 Highland Drive" });
    const accounts = query([{ id: "account_1", name: "Operating", type: "depository" }]);
    const from = vi.fn((table) => table === "property_financial_setups" ? setup : accounts);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { from } });

    const response = await GET(getRequest("930 Highland Drive"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      setup: { id: "setup_1", property_id: "930 Highland Drive" },
      available_accounts: [{ id: "account_1", name: "Operating", type: "depository" }],
    });
  });

  it("returns null setup when the property has never been set up", async () => {
    const setup = query(null);
    const accounts = query([]);
    const from = vi.fn((table) => table === "property_financial_setups" ? setup : accounts);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { from } });

    const response = await GET(getRequest("930 Highland Drive"));
    const body = await response.json();
    expect(body.setup).toBeNull();
  });

  it("rejects a missing property id", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: {} });
    const response = await GET(getRequest(""));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/rental/property-financial-setup", () => {
  let rpc;
  beforeEach(() => {
    vi.clearAllMocks();
    rpc = vi.fn().mockResolvedValue({ data: { setup_id: "setup_1", financial_events_written: 2 }, error: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });
  });

  function validBody(overrides = {}) {
    return {
      propertyId: "930 Highland Drive", financialAccountId: "account_1",
      purchaseDate: "2026-01-15", purchasePrice: "250000", downPayment: "50000",
      closingCosts: "3000", initialValuation: "255000", initialValuationDate: "2026-01-15",
      lenderName: "First National", loanOriginalPrincipal: "200000", loanOriginationDate: "2026-01-15",
      loanCurrentBalance: "198500", loanCurrentBalanceAsOf: "2026-08-01", loanInterestRatePercent: "6.25",
      transactions: [{ date: "2026-02-01", description: "New roof", amount: "12000", capitalized: true }],
      ...overrides,
    };
  }

  it("converts dollars to cents and percent to basis points, forwarding everything to the RPC", async () => {
    const response = await POST(postRequest(validBody()));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("save_property_financial_setup", expect.objectContaining({
      p_owner_id: "owner_1", p_property_id: "930 Highland Drive", p_financial_account_id: "account_1",
      p_purchase_price_cents: 25000000, p_down_payment_cents: 5000000, p_closing_costs_cents: 300000,
      p_initial_valuation_cents: 25500000, p_loan_original_principal_cents: 20000000,
      p_loan_current_balance_cents: 19850000, p_loan_interest_rate_bps: 625,
      p_transactions: [{ event_date: "2026-02-01", description: "New roof", amount_cents: 1200000, capitalized: true }],
    }));
  });

  it("rejects a missing or non-positive purchase price before calling the RPC", async () => {
    const response = await POST(postRequest(validBody({ purchasePrice: "0" })));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a transaction line missing a capital/operating classification", async () => {
    const response = await POST(postRequest(validBody({
      transactions: [{ date: "2026-02-01", description: "New roof", amount: "12000" }],
    })));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects more than 200 transaction lines before calling the RPC", async () => {
    const transactions = Array.from({ length: 201 }, (_, i) => ({
      date: "2026-02-01", description: `Line ${i}`, amount: "100", capitalized: false,
    }));
    const response = await POST(postRequest(validBody({ transactions })));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC validation error (e.g. property does not exist) as a failed response", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("This property does not exist in Rental Manager for this owner.") });
    const response = await POST(postRequest(validBody()));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "This property does not exist in Rental Manager for this owner." });
  });
});
