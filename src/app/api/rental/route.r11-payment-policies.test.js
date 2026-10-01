// R11 payment policies: route tests for the two new operations and the
// policy gate on record-offline-payment. Mocks the authenticated application
// the same way src/app/api/rental/route.test.js does.
import { beforeEach, describe, expect, it, vi } from "vitest";

let memberRole = null;
const rpcCalls = [];
const updateCalls = [];
let balanceChargeRows = [];
let chargeSelect = "";

// Thenable supabase query chain: awaiting it resolves to { data, error },
// maybeSingle()/single() resolve to the first row.
function makeQuery(rowsOrFn) {
  const rowsOf = () => (typeof rowsOrFn === "function" ? rowsOrFn() : rowsOrFn) ?? [];
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    update: vi.fn((values) => { updateCalls.push(values); return chain; }),
    maybeSingle: vi.fn(async () => ({ data: rowsOf()[0] ?? null, error: null })),
    single: vi.fn(async () => ({ data: rowsOf()[0] ?? null, error: null })),
    then: (resolve) => resolve({ data: rowsOf(), error: null }),
  };
  return chain;
}

// Mutable per-test table fixtures.
const tables = {};
function defaultFrom(table) {
  if (table === "workspace_members") return makeQuery(memberRole ? [{ role: memberRole }] : []);
  if (table === "rent_charges") {
    // findPolicyTenantIdForCharge selects lease_id; the gate's balance query
    // selects amount/paid amounts.
    const chain = makeQuery(() => (chargeSelect.includes("paid_amount_cents") ? balanceChargeRows : [{ lease_id: "lease_1" }]));
    const baseSelect = chain.select;
    chain.select = vi.fn((columns) => { chargeSelect = String(columns); return baseSelect(columns); });
    return chain;
  }
  return makeQuery(tables[table] ?? []);
}

const rpc = vi.fn(async (name, params) => {
  rpcCalls.push({ name, params });
  if (name === "set_rental_payment_policy") return { data: { payment_policy: params.p_policy }, error: null };
  if (name === "record_offline_rental_payment") return { data: { id: "payment_1" }, error: null };
  return { data: null, error: null };
});

const application = { units: { findById: vi.fn() } };
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1",
    supabaseClient: { from: vi.fn(defaultFrom), rpc },
  })),
}));
import { POST } from "./route.js";

function request(body) { return new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) }); }

describe("R11 payment policies route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcCalls.length = 0;
    updateCalls.length = 0;
    balanceChargeRows = [];
    chargeSelect = "";
    memberRole = null;
    for (const key of Object.keys(tables)) delete tables[key];
  });

  describe("save-payment-policy", () => {
    it("saves the portfolio policy through the audited RPC", async () => {
      const response = await POST(request({ operation: "save-payment-policy", policy: "require_rent" }));
      expect(response.status).toBe(200);
      expect(rpcCalls).toEqual([{ name: "set_rental_payment_policy",
        params: { p_owner_id: "owner_1", p_policy: "require_rent" } }]);
      expect((await response.json()).paymentPolicy).toBe("require_rent");
    });
    it("rejects an unknown policy with 400", async () => {
      const response = await POST(request({ operation: "save-payment-policy", policy: "require_everything" }));
      expect(response.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    });
    it("blocks read-only members with 403", async () => {
      memberRole = "read_only";
      const response = await POST(request({ operation: "save-payment-policy", policy: "require_balance" }));
      expect(response.status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("save-payment-policy-tenant-override", () => {
    beforeEach(() => { tables.rental_tenants = [{ id: "tenant_1" }]; });
    it("sets the tenant override", async () => {
      const response = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "tenant_1", policy: "require_balance" } }));
      expect(response.status).toBe(200);
      expect(updateCalls).toEqual([{ payment_policy: "require_balance" }]);
    });
    it("clears the override on inherit so the portfolio default applies again", async () => {
      const response = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "tenant_1", policy: "inherit" } }));
      expect(response.status).toBe(200);
      expect(updateCalls).toEqual([{ payment_policy: null }]);
    });
    it("rejects an unknown override policy with 400", async () => {
      const response = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "tenant_1", policy: "require_everything" } }));
      expect(response.status).toBe(400);
      expect(updateCalls).toHaveLength(0);
    });
    it("blocks read-only members with 403", async () => {
      memberRole = "read_only";
      const response = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "tenant_1", policy: "require_rent" } }));
      expect(response.status).toBe(403);
      expect(updateCalls).toHaveLength(0);
    });
    it("rejects an unknown tenant with 400", async () => {
      tables.rental_tenants = [];
      const response = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "missing", policy: "require_rent" } }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("Tenant was not found");
      expect(updateCalls).toHaveLength(0);
    });
  });

  describe("owner-only policy authorization", () => {
    // The R11 contract: policy changes are owner/co-owner only. Staff --
    // manager, bookkeeper, read_only -- may not change the portfolio policy
    // or a tenant override.
    beforeEach(() => { tables.rental_tenants = [{ id: "tenant_1" }]; });
    const staffRoles = ["manager", "bookkeeper", "read_only"];
    it.each(staffRoles)("blocks %s from changing the portfolio policy with 403", async (role) => {
      memberRole = role;
      const response = await POST(request({ operation: "save-payment-policy", policy: "require_rent" }));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toContain("owner or co-owner");
      expect(rpc).not.toHaveBeenCalled();
    });
    it.each(staffRoles)("blocks %s from changing a tenant policy override with 403", async (role) => {
      memberRole = role;
      const response = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "tenant_1", policy: "require_balance" } }));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toContain("owner or co-owner");
      expect(updateCalls).toHaveLength(0);
    });
    it("lets an active co_owner change the portfolio policy", async () => {
      memberRole = "co_owner";
      const response = await POST(request({ operation: "save-payment-policy", policy: "require_rent" }));
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith("set_rental_payment_policy",
        expect.objectContaining({ p_policy: "require_rent" }));
    });
    it("lets an active co_owner change a tenant policy override", async () => {
      memberRole = "co_owner";
      const response = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "tenant_1", policy: "require_balance" } }));
      expect(response.status).toBe(200);
      expect(updateCalls).toEqual([{ payment_policy: "require_balance" }]);
    });
    it("lets the primary owner (no membership row) change both", async () => {
      memberRole = null;
      const portfolio = await POST(request({ operation: "save-payment-policy", policy: "require_rent" }));
      expect(portfolio.status).toBe(200);
      const override = await POST(request({ operation: "save-payment-policy-tenant-override",
        override: { tenantId: "tenant_1", policy: "require_balance" } }));
      expect(override.status).toBe(200);
    });
  });

  describe("record-offline-payment policy gate", () => {
    const basePayment = {
      chargeId: "charge_1", paymentMethod: "cash", receivedAt: "2026-10-01T12:00:00.000Z",
      tenantId: "tenant_1", depositState: "received",
    };
    beforeEach(() => {
      tables.rental_billing_settings = [{ payment_policy: "require_balance" }];
      tables.rental_tenants = [{ id: "tenant_1", payment_policy: null }];
      tables.rental_lease_tenants = [{ tenant_id: "tenant_1", lease_id: "lease_1", occupancy_role: "primary" }];
      tables.rental_leases = [{ monthly_rent_cents: 160000 }];
      tables.rent_schedules = [{ amount_cents: 160000, effective_start_date: "2026-09-01" }];
      balanceChargeRows = [
        { amount_cents: 160000, paid_amount_cents: 0 },
        { amount_cents: 160000, paid_amount_cents: 0 },
      ];
    });
    function paymentRequest(amountCents) {
      return POST(request({ operation: "record-offline-payment", payment: { ...basePayment, amountCents } }));
    }
    it("rejects with 422 and a plain-English message when the amount is below the full balance", async () => {
      const response = await paymentRequest(160000);
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("Your payment must cover the full balance of $3,200.00.");
      expect(rpc).not.toHaveBeenCalled();
    });
    it("derives the tenant from the charge when no tenantId is supplied", async () => {
      const { tenantId, ...withoutTenant } = basePayment;
      const response = await POST(request({ operation: "record-offline-payment", payment: { ...withoutTenant, amountCents: 160000 } }));
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("Your payment must cover the full balance of $3,200.00.");
      expect(rpc).not.toHaveBeenCalled();
    });
    it("records when the amount covers the full balance", async () => {
      const response = await paymentRequest(320000);
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith("record_offline_rental_payment", expect.objectContaining({ p_amount_cents: 320000 }));
    });
    it("applies the tenant override over the workspace default", async () => {
      tables.rental_tenants = [{ id: "tenant_1", payment_policy: "allow_any_amount" }];
      const response = await paymentRequest(5000);
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalled();
    });
    it("never blocks under the allow_any_amount default", async () => {
      tables.rental_billing_settings = [{ payment_policy: "allow_any_amount" }];
      const response = await paymentRequest(5000);
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalled();
    });
  });
});
