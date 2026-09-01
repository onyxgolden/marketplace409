import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { DELETE, PATCH, POST } from "./route";

const assetBody = {
  assetId: "asset_1",
  name: "2015 Toyota Tacoma",
  assetClass: "vehicle",
  ownershipScope: "business",
  valueCents: 1800000,
  valueDate: "2026-08-25",
  purchaseCostCents: 2200000,
  purchaseDate: "2015-03-01",
  notes: "Work truck",
};

function request(method, body) {
  return new Request("http://localhost/api/financial/assets", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("financial asset lifecycle route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new asset when purchaseCostCents is simply omitted, not just when it's explicitly null", async () => {
    // Regression: parseAssetBody's optional-field parsing is `body?.purchaseCostCents === null ||
    // === "" ? null : Number(body?.purchaseCostCents)` -- an omitted (undefined) field skips both
    // branches and becomes Number(undefined) = NaN, which then fails "must be whole cents"
    // validation. The sidebar's own "+ Add asset" form doesn't collect a purchase cost at all, so
    // this is the exact shape it sends.
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: "asset_new", name: "2015 Toyota Tacoma", asset_class: "vehicle", ownership_scope: "business", active: true,
    }, error: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });

    const response = await POST(request("POST", {
      name: "2015 Toyota Tacoma", assetClass: "vehicle", ownershipScope: "business",
      valueCents: 1800000, valueDate: "2026-08-25",
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_financial_asset_with_valuation", expect.objectContaining({
      p_purchase_cost_cents: null,
    }));
  });

  it("updates details and records a new manual valuation atomically", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: "asset_1", name: assetBody.name, asset_class: "vehicle",
      ownership_scope: "business", purchase_cost_cents: 2200000, active: true,
    }, error: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });

    const response = await PATCH(request("PATCH", assetBody));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_financial_asset_with_valuation", expect.objectContaining({
      p_asset_id: "asset_1",
      p_name: "2015 Toyota Tacoma",
      p_value_cents: 1800000,
      p_value_date: "2026-08-25",
      p_value_source: "manual",
    }));
  });

  it("rejects an invalid valuation before calling the database", async () => {
    const rpc = vi.fn();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await PATCH(request("PATCH", { ...assetBody, valueCents: -1 }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("soft-retires the asset and its canonical net-worth account", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: "asset_1", name: assetBody.name, asset_class: "vehicle",
      ownership_scope: "business", active: false,
    }, error: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { rpc } });

    const response = await DELETE(request("DELETE", { assetId: "asset_1" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("deactivate_financial_asset", { p_asset_id: "asset_1" });
  });

  it("requires authentication for lifecycle mutations", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await PATCH(request("PATCH", assetBody))).status).toBe(401);
    expect((await DELETE(request("DELETE", { assetId: "asset_1" }))).status).toBe(401);
  });
});
