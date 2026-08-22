import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticated = { user: { id: "owner_1" }, supabaseClient: {} };
const unauthenticatedResponse = { response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

const transactionLedger = vi.fn();
vi.mock("@/domains/rentec-rental-migration/rentec-api.client", () => ({ createRentecApiClient: () => ({ transactionLedger: (...args) => transactionLedger(...args) }) }));

import { POST } from "./route.js";

function request(body) {
  return new NextRequest("https://forge.test/api/rental/rentec-payment-import-preview", { method: "POST", body: JSON.stringify(body) });
}

function chain(data) {
  const node = { eq: () => node, then: (resolve) => resolve({ data, error: null }) };
  return { select: () => node };
}

const tenantRow = { id: "tenant_1", source_record_id: "rentec_renter_1" };
const unitRow = { id: "unit_1", source_record_id: "rentec_property_1" };
const leaseRow = { id: "lease_1", unit_id: "unit_1" };
const leaseTenantRow = { lease_id: "lease_1", tenant_id: "tenant_1" };
const scheduleRow = { id: "schedule_1", lease_id: "lease_1", collection_mode: "external", effective_start_date: "2026-01-01" };
const chargeRow = { id: "charge_1", lease_id: "lease_1", period: "2026-08", due_date: "2026-08-01", amount_cents: 150000, paid_amount_cents: 0, status: "due" };

function mockDatabase({ tenants = [tenantRow], units = [unitRow], leases = [leaseRow], leaseTenants = [leaseTenantRow],
  schedules = [scheduleRow], charges = [chargeRow], imports = [] } = {}) {
  return {
    from: (table) => {
      if (table === "rental_tenants") return chain(tenants);
      if (table === "rental_units") return chain(units);
      if (table === "rental_leases") return chain(leases);
      if (table === "rental_lease_tenants") return chain(leaseTenants);
      if (table === "rent_schedules") return chain(schedules);
      if (table === "rent_charges") return chain(charges);
      if (table === "rentec_transaction_imports") return chain(imports);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("rentec payment import preview route", () => {
  beforeEach(() => { vi.clearAllMocks(); createAuthenticatedForgeApplication.mockResolvedValue(authenticated); });

  it("rejects unauthenticated callers", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce(unauthenticatedResponse);
    const response = await POST(request({ propertyId: "10" }));
    expect(response.status).toBe(401);
  });

  it("requires a valid numeric Rentec propertyId", async () => {
    const response = await POST(request({ propertyId: "not-a-number" }));
    expect(response.status).toBe(400);
  });

  it("is read-only — never calls .rpc or any write method, only select/eq reads", async () => {
    const db = mockDatabase();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: db });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    expect(db.rpc).toBeUndefined();
    const response = await POST(request({ propertyId: "10" }));
    expect(response.status).toBe(200);
  });

  it("labels the response as preview_only", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    const response = await POST(request({ propertyId: "10" }));
    const body = await response.json();
    expect(body.status).toBe("preview_only");
    expect(body.importBatchId).toMatch(/^rentec_import_batch_/);
  });

  it("returns a matched classification for a linked tenant/lease/charge with an exact amount", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    transactionLedger.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [{ transactionId: "txn_1", renterId: "rentec_renter_1", propertyId: "rentec_property_1", amountCents: 150000, transactionDate: "2026-08-05", categoryName: "Rent Payment" }],
    });
    const response = await POST(request({ propertyId: "10" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preview.classificationCounts.matched).toBe(1);
    expect(body.preview.items[0]).toMatchObject({ classification: "matched", chargeId: "charge_1", leaseId: "lease_1" });
  });

  it("excludes an already-applied Rentec transaction id from re-matching, classifying it as already_imported when the fresh evidence is unchanged", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ imports: [{
      rentec_transaction_id: "txn_1", lease_id: "lease_1", charge_id: "charge_1", amount_cents: 150000,
      transaction_date: "2026-08-05", category_name: "Rent Payment", rentec_renter_id: "rentec_renter_1", rentec_property_id: "rentec_property_1",
    }] }) });
    transactionLedger.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [{ transactionId: "txn_1", renterId: "rentec_renter_1", propertyId: "rentec_property_1", amountCents: 150000, transactionDate: "2026-08-05", categoryName: "Rent Payment" }],
    });
    const response = await POST(request({ propertyId: "10" }));
    const body = await response.json();
    expect(body.preview.classificationCounts.already_imported).toBe(1);
  });

  it("classifies a previously-imported transaction whose fresh Rentec amount now differs as conflict, not already_imported", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ imports: [{
      rentec_transaction_id: "txn_1", lease_id: "lease_1", charge_id: "charge_1", amount_cents: 150000,
      transaction_date: "2026-08-05", category_name: "Rent Payment", rentec_renter_id: "rentec_renter_1", rentec_property_id: "rentec_property_1",
    }] }) });
    transactionLedger.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [{ transactionId: "txn_1", renterId: "rentec_renter_1", propertyId: "rentec_property_1", amountCents: 175000, transactionDate: "2026-08-05", categoryName: "Rent Payment" }],
    });
    const response = await POST(request({ propertyId: "10" }));
    const body = await response.json();
    expect(body.preview.classificationCounts.conflict).toBe(1);
    expect(body.preview.classificationCounts.already_imported).toBe(0);
  });

  it("paginates the Rentec transaction ledger until moreRecords is false", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    transactionLedger
      .mockResolvedValueOnce({ page: 1, moreRecords: true, transactions: [] })
      .mockResolvedValueOnce({ page: 2, moreRecords: false, transactions: [] });
    const response = await POST(request({ propertyId: "10" }));
    expect(response.status).toBe(200);
    expect(transactionLedger).toHaveBeenCalledTimes(2);
    expect(transactionLedger).toHaveBeenNthCalledWith(1, { propertyId: "10", page: 1 });
    expect(transactionLedger).toHaveBeenNthCalledWith(2, { propertyId: "10", page: 2 });
  });

  it("owner isolation: scopes every FORGE table read to the authenticated owner id, ignoring any ownerId submitted in the request body", async () => {
    const eqCalls = [];
    const trackedChain = (data) => {
      const node = { eq: (...args) => { eqCalls.push(args); return node; }, then: (resolve) => resolve({ data, error: null }) };
      return { select: () => node };
    };
    const db = {
      from: (table) => trackedChain({
        rental_tenants: [tenantRow], rental_units: [unitRow], rental_leases: [leaseRow], rental_lease_tenants: [leaseTenantRow],
        rent_schedules: [scheduleRow], rent_charges: [chargeRow], rentec_transaction_imports: [],
      }[table]),
    };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: db });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    await POST(request({ propertyId: "10", ownerId: "owner_attacker" }));
    expect(eqCalls.some(([field, value]) => field === "owner_id" && value === "owner_attacker")).toBe(false);
    expect(eqCalls.filter(([field, value]) => field === "owner_id" && value === "owner_1").length).toBe(7);
  });

  it("stops paginating at the bounded page limit even if moreRecords stays true", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    transactionLedger.mockResolvedValue({ page: 1, moreRecords: true, transactions: [] });
    const response = await POST(request({ propertyId: "10" }));
    expect(response.status).toBe(200);
    expect(transactionLedger.mock.calls.length).toBeLessThanOrEqual(50);
  });
});
