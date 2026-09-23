import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// Tables keyed by name; each query chain resolves { data, error } at the terminal call.
function chainFor(rows) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    filter: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: rows?.[0] ?? null, error: null })),
    then: undefined,
  };
  // Make the chain awaitable for list queries.
  chain.then = (resolve) => Promise.resolve({ data: rows || [], error: null }).then(resolve);
  return chain;
}

let tables = {};
let actor = { user: { id: "owner_1" }, effectiveOwnerId: "owner_1" };

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({
    ...actor,
    application: {},
    supabaseClient: { from: vi.fn((table) => chainFor(tables[table])) },
  })),
}));

vi.mock("@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents", () => ({
  fetchAllOwnerFinancialEvents: vi.fn(async () => []),
}));

import { GET as tenantLedgerGET } from "./tenant-ledger/route.js";
import { GET as propertyExpensesGET } from "./property-expenses/route.js";

function get(url) { return new Request(url, { method: "GET" }); }

describe("tenant-ledger route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor = { user: { id: "owner_1" }, effectiveOwnerId: "owner_1" };
    tables = {
      rental_tenants: [{ id: "tenant_1", display_name: "Paula", email: "paula@example.com", status: "active" }],
      rent_charges: [{ id: "charge_1", lease_id: "lease_1", period: "2026-08", due_date: "2026-08-01", amount_cents: 150000, paid_amount_cents: 150000, status: "paid", charge_type: "rent" }],
      rental_payments: [{ id: "pay_1", charge_id: "charge_1", lease_id: "lease_1", tenant_id: "tenant_1", provider: "stripe", provider_payment_id: "pi_1", amount_cents: 150000, refunded_amount_cents: 0, status: "succeeded", payment_method: "card", received_at: "2026-08-02T12:00:00Z", created_at: "2026-08-02T12:00:00Z" }],
      rental_settlements: [],
      rental_leases: [{ id: "lease_1", unit_id: "unit_a", property_id: "4800-kent-ave", status: "active" }],
      rental_lease_tenants: [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }],
      rental_units: [{ id: "unit_a", property_id: "4800-kent-ave", label: "Main residence", status: "occupied" }],
      rentec_transaction_imports: [],
      rental_security_deposits: [],
      rental_security_deposit_transactions: [],
    };
  });

  it("returns the tenant ledger with entries, last-3, and deposits", async () => {
    const response = await tenantLedgerGET(get("http://localhost/api/rental/tenant-ledger?tenantId=tenant_1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.tenant.display_name).toBe("Paula");
    expect(body.ledger.entries).toHaveLength(2);
    expect(body.ledger.last3).toHaveLength(1);
    expect(body.ledger.balanceCents).toBe(0);
    expect(body.deposits.entries).toHaveLength(0);
    expect(body.canonicalOwnerId).toBe("owner_1");
  });

  it("serves a co-owner from the canonical owner's books", async () => {
    actor = { user: { id: "brandy_user" }, effectiveOwnerId: "owner_1" };
    const response = await tenantLedgerGET(get("http://localhost/api/rental/tenant-ledger?tenantId=tenant_1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canonicalOwnerId).toBe("owner_1");
    expect(body.actingUserId).toBe("brandy_user");
    expect(body.ledger.entries).toHaveLength(2);
  });

  it("404s a tenant id from another workspace instead of leaking history", async () => {
    tables.rental_tenants = [];
    const response = await tenantLedgerGET(get("http://localhost/api/rental/tenant-ledger?tenantId=tenant_other_ws"));
    expect(response.status).toBe(404);
  });

  it("requires tenantId", async () => {
    const response = await tenantLedgerGET(get("http://localhost/api/rental/tenant-ledger"));
    expect(response.status).toBe(400);
  });

  it("returns an empty importedHistory when the tenant has no migration renter id", async () => {
    const response = await tenantLedgerGET(get("http://localhost/api/rental/tenant-ledger?tenantId=tenant_1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.importedHistory).toEqual({ renterId: null, rows: [], totalCents: 0 });
  });

  it("links Rentec-imported income rows by exact renter id with non-billing semantics", async () => {
    tables.rental_tenants = [{ id: "tenant_1", display_name: "Paula", email: "paula@example.com", status: "active", source_record_id: "renter_9" }];
    tables.financial_events = [
      { id: "evt_1", event_date: "2026-03-01", description: "Rent", amount: 1500.0, transaction_kind: "income", normalized_category: "rent_income", property_id: "4800-kent-ave", source_record_id: "txn1:splitA", metadata: { rentec_transaction_id: "txn1", rentec_renter_id: "renter_9" }, status: "posted", is_deleted: false },
      { id: "evt_2", event_date: "2026-02-01", description: "Rent", amount: 1500.0, transaction_kind: "income", normalized_category: "rent_income", property_id: "4800-kent-ave", source_record_id: "txn2:splitA", metadata: { rentec_transaction_id: "txn2", rentec_renter_id: "renter_9" }, status: "posted", is_deleted: false },
      { id: "evt_other", event_date: "2026-03-01", description: "Rent", amount: 900.0, transaction_kind: "income", normalized_category: "rent_income", property_id: "other", source_record_id: "txnX:none", metadata: { rentec_transaction_id: "txnX", rentec_renter_id: "renter_other" }, status: "posted", is_deleted: false },
    ];
    const response = await tenantLedgerGET(get("http://localhost/api/rental/tenant-ledger?tenantId=tenant_1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.importedHistory.renterId).toBe("renter_9");
    // evt_other fails the builder's exact renter-id match (the mock ignores SQL filters).
    expect(body.importedHistory.rows.map((row) => row.id)).toEqual(["evt_1", "evt_2"]);
    for (const row of body.importedHistory.rows) {
      expect(row.source).toBe("rentec");
      expect(row.affectsBalance).toBe(false);
      expect(row.attribution).toBe("rentec_renter_id_match");
    }
    expect(body.importedHistory.totalCents).toBe(300000);
    // The billing ledger is untouched by the imported rows.
    expect(body.ledger.balanceCents).toBe(0);
  });

  it("dedups imported rows already represented as rentec_external payments", async () => {
    tables.rental_tenants = [{ id: "tenant_1", display_name: "Paula", email: "paula@example.com", status: "active", source_record_id: "renter_9" }];
    tables.rental_payments = [
      { id: "pay_rentec", charge_id: "charge_1", lease_id: "lease_1", tenant_id: "tenant_1", provider: "rentec_external", provider_payment_id: "txn1", amount_cents: 150000, refunded_amount_cents: 0, status: "succeeded", payment_method: "ach", received_at: "2026-03-01T12:00:00Z", created_at: "2026-03-01T12:00:00Z" },
      { id: "pay_stripe", charge_id: null, lease_id: "lease_1", tenant_id: "tenant_1", provider: "stripe", provider_payment_id: "txn2", amount_cents: 150000, refunded_amount_cents: 0, status: "succeeded", payment_method: "card", received_at: "2026-02-01T12:00:00Z", created_at: "2026-02-01T12:00:00Z" },
    ];
    tables.financial_events = [
      { id: "evt_1", event_date: "2026-03-01", description: "Rent", amount: 1500.0, transaction_kind: "income", normalized_category: "rent_income", property_id: "4800-kent-ave", source_record_id: "txn1:splitA", metadata: { rentec_transaction_id: "txn1", rentec_renter_id: "renter_9" }, status: "posted", is_deleted: false },
      { id: "evt_2", event_date: "2026-02-01", description: "Rent", amount: 1500.0, transaction_kind: "income", normalized_category: "rent_income", property_id: "4800-kent-ave", source_record_id: "txn2:splitA", metadata: { rentec_transaction_id: "txn2", rentec_renter_id: "renter_9" }, status: "posted", is_deleted: false },
    ];
    const response = await tenantLedgerGET(get("http://localhost/api/rental/tenant-ledger?tenantId=tenant_1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    // txn1 is suppressed (rentec_external payment exists); txn2 stays (its payment
    // is under the stripe provider, so it is not in the dedup set).
    expect(body.importedHistory.rows.map((row) => row.id)).toEqual(["evt_2"]);
  });
});

describe("property-expenses route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor = { user: { id: "owner_1" }, effectiveOwnerId: "owner_1" };
    tables = {
      rental_units: [{ id: "unit_laxon", property_id: "145-laxon", label: "145 Laxon", status: "occupied" }],
      rental_contractor_payments: [{ id: "rental_contractor_payment_1", contractor_id: "con_1", work_order_id: null, property_id: "145-laxon", paid_at: "2026-09-10", amount_cents: 45000, payment_method: "check", reference: null, invoice_reference: "INV-77", notes: null }],
      rental_contractors: [{ id: "con_1", business_name: "Gulf Coast Plumbing", trade: "Plumbing" }],
    };
  });

  it("returns the property expense ledger for the resolved unit", async () => {
    const response = await propertyExpensesGET(get("http://localhost/api/rental/property-expenses?propertyId=145-laxon"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.unit.property_id).toBe("145-laxon");
    expect(body.ledger.entries).toHaveLength(1);
    expect(body.ledger.entries[0].vendor).toBe("Gulf Coast Plumbing");
    expect(body.ledger.totalCents).toBe(45000);
  });

  it("resolves by unit id as well as the property slug", async () => {
    const response = await propertyExpensesGET(get("http://localhost/api/rental/property-expenses?propertyId=unit_laxon"));
    expect(response.status).toBe(200);
    expect((await response.json()).unit.id).toBe("unit_laxon");
  });

  it("serves a co-owner from the canonical owner's books", async () => {
    actor = { user: { id: "brandy_user" }, effectiveOwnerId: "owner_1" };
    const response = await propertyExpensesGET(get("http://localhost/api/rental/property-expenses?propertyId=145-laxon"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canonicalOwnerId).toBe("owner_1");
    expect(body.ledger.entries).toHaveLength(1);
  });

  it("404s a property id from another workspace", async () => {
    tables.rental_units = [];
    const response = await propertyExpensesGET(get("http://localhost/api/rental/property-expenses?propertyId=someone-elses-place"));
    expect(response.status).toBe(404);
  });

  it("requires propertyId", async () => {
    const response = await propertyExpensesGET(get("http://localhost/api/rental/property-expenses"));
    expect(response.status).toBe(400);
  });
});
