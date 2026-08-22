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
  return new NextRequest("https://forge.test/api/rental/rentec-payment-import-approve", { method: "POST", body: JSON.stringify(body) });
}

function validApproval(overrides = {}) {
  return { transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1", ...overrides };
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
const rentecTxn = { transactionId: "txn_1", renterId: "rentec_renter_1", propertyId: "rentec_property_1", amountCents: 150000, transactionDate: "2026-08-05", categoryName: "Rent Payment" };

function mockDatabase({ tenants = [tenantRow], units = [unitRow], leases = [leaseRow], leaseTenants = [leaseTenantRow],
  schedules = [scheduleRow], charges = [chargeRow], imports = [], rpc } = {}) {
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
    rpc: rpc || vi.fn(),
  };
}

describe("rentec payment import approve route", () => {
  beforeEach(() => { vi.clearAllMocks(); createAuthenticatedForgeApplication.mockResolvedValue(authenticated); });

  it("rejects unauthenticated callers", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce(unauthenticatedResponse);
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval()] }));
    expect(response.status).toBe(401);
  });

  it("requires an importBatchId", async () => {
    const response = await POST(request({ propertyId: "10", approvals: [validApproval()] }));
    expect(response.status).toBe(400);
  });

  it("requires a valid numeric propertyId", async () => {
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "not-a-number", approvals: [validApproval()] }));
    expect(response.status).toBe(400);
  });

  it("requires at least one approval", async () => {
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [] }));
    expect(response.status).toBe(400);
  });

  it("rejects an approval missing required fields", async () => {
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [{ transactionId: "txn_1" }] }));
    expect(response.status).toBe(400);
  });

  it("rejects more than 200 approvals in one batch", async () => {
    const approvals = Array.from({ length: 201 }, (_, i) => validApproval({ transactionId: `txn_${i}` }));
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals }));
    expect(response.status).toBe(400);
  });

  it("approves a transaction whose fresh re-fetch and re-match agree with the submitted mapping", async () => {
    const rpc = vi.fn(async () => ({ data: { status: "applied", importId: "import_1", paymentId: "payment_1", chargeId: "charge_1" }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpc }) });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecTxn] });
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval()] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("approve_rentec_payment_import", {
      p_owner_id: "owner_1", p_lease_id: "lease_1", p_charge_id: "charge_1", p_rentec_transaction_id: "txn_1",
      p_amount_cents: 150000, p_transaction_date: "2026-08-05", p_category_name: "Rent Payment",
      p_rentec_renter_id: "rentec_renter_1", p_rentec_property_id: "rentec_property_1", p_import_batch_id: "batch_1",
    });
    expect(body.results).toEqual([{ transactionId: "txn_1", status: "applied", importId: "import_1", paymentId: "payment_1", chargeId: "charge_1" }]);
  });

  // Source authenticity: the client's claimed financial facts are never trusted or forwarded — only
  // the freshly re-fetched, freshly re-matched values ever reach the RPC.
  it("never uses a client-submitted amount — the RPC always receives the freshly re-fetched Rentec amount, even if the client tried to submit something else", async () => {
    const rpc = vi.fn(async () => ({ data: { status: "applied" }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpc }) });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecTxn] });
    await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval({ amountCents: 999999999, transactionDate: "2099-01-01", categoryName: "Fabricated" })] }));
    expect(rpc).toHaveBeenCalledWith("approve_rentec_payment_import", expect.objectContaining({ p_amount_cents: 150000, p_transaction_date: "2026-08-05", p_category_name: "Rent Payment" }));
  });

  it("cannot fabricate a Rentec-external payment for a transaction id that does not actually exist in Rentec — never calls the RPC", async () => {
    const rpc = vi.fn();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpc }) });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] }); // no such transaction in Rentec
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval({ transactionId: "fabricated_txn" })] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(body.results[0]).toMatchObject({ transactionId: "fabricated_txn", status: "error" });
  });

  it("cannot redirect a real transaction onto a different charge than the fresh match resolved — never calls the RPC", async () => {
    const rpc = vi.fn();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpc }) });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecTxn] });
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval({ chargeId: "a_different_charge_the_landlord_does_not_own" })] }));
    const body = await response.json();
    expect(rpc).not.toHaveBeenCalled();
    expect(body.results[0].status).toBe("error");
  });

  // Gap 2: a drift-detected conflict must never reach the RPC — no balance mutation, no audit
  // insert. Only a freshly-rematched 'matched' item can ever call the RPC.
  it("a drift-detected conflict (changed amount since a prior import) makes no RPC call at all — no balance or audit mutation", async () => {
    const rpc = vi.fn();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpc, imports: [{
      rentec_transaction_id: "txn_1", lease_id: "lease_1", charge_id: "charge_1", amount_cents: 100000,
      transaction_date: "2026-08-05", category_name: "Rent Payment", rentec_renter_id: "rentec_renter_1", rentec_property_id: "rentec_property_1",
    }] }) });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecTxn] }); // rentecTxn amountCents=150000, drifted from stored 100000
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval()] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(body.results[0].status).toBe("error");
  });

  it("rejects an approval whose fresh classification is no longer 'matched' (e.g. it now classifies as ambiguous, conflict, or already_imported)", async () => {
    const rpc = vi.fn();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpc, imports: [{ rentec_transaction_id: "txn_1" }] }) });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecTxn] });
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval()] }));
    const body = await response.json();
    expect(rpc).not.toHaveBeenCalled();
    expect(body.results[0].status).toBe("error");
  });

  it("owner isolation: always scopes FORGE reads to the authenticated owner id, ignoring any ownerId submitted in the request body", async () => {
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
      rpc: vi.fn(async () => ({ data: { status: "applied" }, error: null })),
    };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: db });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecTxn] });
    await POST(request({ importBatchId: "batch_1", propertyId: "10", ownerId: "owner_attacker", approvals: [validApproval()] }));
    expect(eqCalls.some(([field, value]) => field === "owner_id" && value === "owner_attacker")).toBe(false);
    expect(db.rpc).toHaveBeenCalledWith("approve_rentec_payment_import", expect.objectContaining({ p_owner_id: "owner_1" }));
  });

  it("processes every entry in a batch independently — one entry the RPC rejects does not block or omit the others", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { status: "rejected", importId: "import_1", reason: "Transaction amount exceeds the charge's current remaining balance." }, error: null })
      .mockResolvedValueOnce({ data: { status: "applied", importId: "import_2", paymentId: "payment_2", chargeId: "charge_2" }, error: null });
    const secondUnit = { id: "unit_2", source_record_id: "rentec_property_2" };
    const secondLease = { id: "lease_2", unit_id: "unit_2" };
    const secondLeaseTenant = { lease_id: "lease_2", tenant_id: "tenant_1" };
    const secondSchedule = { id: "schedule_2", lease_id: "lease_2", collection_mode: "external", effective_start_date: "2026-01-01" };
    const secondCharge = { id: "charge_2", lease_id: "lease_2", period: "2026-08", due_date: "2026-08-01", amount_cents: 200000, paid_amount_cents: 0, status: "due" };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({
      rpc, units: [unitRow, secondUnit], leases: [leaseRow, secondLease], leaseTenants: [leaseTenantRow, secondLeaseTenant],
      schedules: [scheduleRow, secondSchedule], charges: [chargeRow, secondCharge],
    }) });
    transactionLedger.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [rentecTxn, { ...rentecTxn, transactionId: "txn_2", propertyId: "rentec_property_2", amountCents: 200000 }],
    });
    const response = await POST(request({
      importBatchId: "batch_1", propertyId: "10",
      approvals: [validApproval(), validApproval({ transactionId: "txn_2", leaseId: "lease_2", chargeId: "charge_2" })],
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe("rejected");
    expect(body.results[1].status).toBe("applied");
  });

  it("surfaces a repeated approval as already_applied rather than an error — idempotent at the route level too", async () => {
    const rpc = vi.fn(async () => ({ data: { status: "already_applied", importId: "import_1", paymentId: "payment_1", chargeId: "charge_1" }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpc }) });
    transactionLedger.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecTxn] });
    const response = await POST(request({ importBatchId: "batch_1", propertyId: "10", approvals: [validApproval()] }));
    const body = await response.json();
    expect(body.results[0].status).toBe("already_applied");
  });

  it("captures a per-entry RPC error without aborting the rest of the batch", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Lease tenant was not found." } })
      .mockResolvedValueOnce({ data: { status: "applied", importId: "import_2", paymentId: "payment_2", chargeId: "charge_2" }, error: null });
    const secondUnit = { id: "unit_2", source_record_id: "rentec_property_2" };
    const secondLease = { id: "lease_2", unit_id: "unit_2" };
    const secondLeaseTenant = { lease_id: "lease_2", tenant_id: "tenant_1" };
    const secondSchedule = { id: "schedule_2", lease_id: "lease_2", collection_mode: "external", effective_start_date: "2026-01-01" };
    const secondCharge = { id: "charge_2", lease_id: "lease_2", period: "2026-08", due_date: "2026-08-01", amount_cents: 200000, paid_amount_cents: 0, status: "due" };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({
      rpc, units: [unitRow, secondUnit], leases: [leaseRow, secondLease], leaseTenants: [leaseTenantRow, secondLeaseTenant],
      schedules: [scheduleRow, secondSchedule], charges: [chargeRow, secondCharge],
    }) });
    transactionLedger.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [rentecTxn, { ...rentecTxn, transactionId: "txn_2", propertyId: "rentec_property_2", amountCents: 200000 }],
    });
    const response = await POST(request({
      importBatchId: "batch_1", propertyId: "10",
      approvals: [validApproval(), validApproval({ transactionId: "txn_2", leaseId: "lease_2", chargeId: "charge_2" })],
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results[0]).toEqual({ transactionId: "txn_1", status: "error", reason: "Lease tenant was not found." });
    expect(body.results[1].status).toBe("applied");
  });
});
