import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticated = { user: { id: "owner_1" }, supabaseClient: {} };
const unauthenticatedResponse = { response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

const inventory = vi.fn();
const financialHistoryTransactions = vi.fn();
vi.mock("@/domains/rentec-rental-migration/rentec-api.client", () => ({
  createRentecApiClient: () => ({ inventory: (...args) => inventory(...args), financialHistoryTransactions: (...args) => financialHistoryTransactions(...args) }),
}));

import { POST } from "./route.js";

function request() {
  return new NextRequest("https://forge.test/api/rental/rentec-financial-history-import-preview", { method: "POST" });
}

function financialEventsChain(rows) {
  const eqCalls = [];
  const node = { eq: (...args) => { eqCalls.push(args); return node; }, range: () => Promise.resolve({ data: rows, error: null }) };
  return { select: () => node, __eqCalls: eqCalls };
}

function mockDatabase({ financialEvents = [] } = {}) {
  const chain = financialEventsChain(financialEvents);
  return { from: (table) => { if (table === "financial_events") return chain; throw new Error(`Unexpected table: ${table}`); }, __financialEventsChain: chain };
}

const oneProperty = { propertyIds: ["10"], propertyReferences: [{ id: "10", label: "1218 Wagner St" }] };

describe("rentec financial history import preview route", () => {
  beforeEach(() => { vi.clearAllMocks(); createAuthenticatedForgeApplication.mockResolvedValue(authenticated); });

  it("rejects unauthenticated callers, never calling Rentec", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce(unauthenticatedResponse);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(inventory).not.toHaveBeenCalled();
  });

  it("is read-only — never calls .rpc, only reads financial_events", async () => {
    const db = mockDatabase();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: db });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    expect(db.rpc).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
  });

  it("labels the response as preview_only and never writes", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    const response = await POST(request());
    const body = await response.json();
    expect(body.status).toBe("preview_only");
    expect(body.success).toBe(true);
  });

  it("scans every property returned by inventory(), including archived ones (archived filtering is inventory()'s own responsibility)", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockResolvedValueOnce({
      propertyIds: ["10", "11"],
      propertyReferences: [{ id: "10", label: "1218 Wagner St" }, { id: "11", label: "42 Archived Ln" }],
    });
    financialHistoryTransactions.mockResolvedValue({ page: 1, moreRecords: false, transactions: [] });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.propertiesScanned).toBe(2);
    expect(financialHistoryTransactions).toHaveBeenCalledWith({ propertyId: "10", page: 1 });
    expect(financialHistoryTransactions).toHaveBeenCalledWith({ propertyId: "11", page: 1 });
  });

  it("paginates each property's transactions until moreRecords is false", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions
      .mockResolvedValueOnce({ page: 1, moreRecords: true, transactions: [] })
      .mockResolvedValueOnce({ page: 2, moreRecords: false, transactions: [] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(financialHistoryTransactions).toHaveBeenCalledTimes(2);
    expect(financialHistoryTransactions).toHaveBeenNthCalledWith(1, { propertyId: "10", page: 1 });
    expect(financialHistoryTransactions).toHaveBeenNthCalledWith(2, { propertyId: "10", page: 2 });
  });

  // RENTEC-01-FIX #2: previously this silently stopped and returned a 200 with a truncated result.
  // A preview built from an incomplete source fetch could under-report "safe missing" rows without
  // any indication - it must fail closed instead.
  it("fails closed with an error, rather than silently returning a truncated preview, when moreRecords stays true past the bounded page cap", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValue({ page: 1, moreRecords: true, transactions: [] });
    const response = await POST(request());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/50-page safety cap/);
    expect(financialHistoryTransactions.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("scopes the financial_events read to the authenticated owner id", async () => {
    const db = mockDatabase();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: db });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    await POST(request());
    expect(db.__financialEventsChain.__eqCalls).toContainEqual(["owner_id", "owner_1"]);
  });

  it("classifies a fetched transaction with no matching existing event as safe missing, in the returned preview", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [{ transactionId: "500", splitId: null, propertyId: "10", renterId: "7", amountCents: 100000, transactionDate: "2021-04-01", categoryId: "9", categoryName: "Rental Income", bankId: null, rentecOwnerId: null, vendorId: null, checkNum: null, pmtType: null, notes: null }],
    });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preview.classificationCounts.safeMissing).toBe(1);
  });

  it("classifies a fetched transaction matching an existing CSV-imported event as already represented", async () => {
    const existingEvent = {
      id: "evt-1", property_id: "1218-wagner-st", event_date: "2020-03-01", description: "Rental Income",
      amount: 1000, transaction_kind: "income", normalized_category: "rental_income", source_system: "rentec",
      source_record_id: "rentec-2020-03-01-4-income", status: "active", is_deleted: false,
    };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ financialEvents: [existingEvent] }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [{ transactionId: "500", splitId: null, propertyId: "10", renterId: "7", amountCents: 100000, transactionDate: "2020-03-01", categoryId: "9", categoryName: "Rental Income", bankId: null, rentecOwnerId: null, vendorId: null, checkNum: null, pmtType: null, notes: null }],
    });
    const response = await POST(request());
    const body = await response.json();
    expect(body.preview.classificationCounts.alreadyRepresented).toBe(1);
  });

  it("returns an error response if the Rentec fetch throws, without writing anything", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockRejectedValueOnce(new Error("Rentec API request failed with HTTP 500."));
    const response = await POST(request());
    expect(response.status).toBe(500);
  });

  describe("batchPlan (drives the authenticated import-control UI)", () => {
    it("groups a safe-missing transaction into its year's batch", async () => {
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({
        page: 1, moreRecords: false,
        transactions: [{ transactionId: "500", splitId: null, propertyId: "10", renterId: "7", amountCents: 100000, transactionDate: "2021-04-01", categoryId: "9", categoryName: "Rental Income", bankId: null, rentecOwnerId: null, vendorId: null, checkNum: null, pmtType: null, notes: null }],
      });
      const response = await POST(request());
      const body = await response.json();
      expect(body.batchPlan.eligibleByYear).toEqual([
        { year: "2021", count: 1, incomeCents: 100000, expenseCents: 0, otherCents: 0, sourceRecordIds: ["500:none"] },
      ]);
      expect(body.batchPlan.heldBackCommissions).toEqual({ count: 0, amountCents: 0 });
    });

    it("holds back a Commissions-category safe-missing transaction out of the batch plan entirely", async () => {
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({
        page: 1, moreRecords: false,
        transactions: [{ transactionId: "500", splitId: null, propertyId: "10", renterId: null, amountCents: -11250000, transactionDate: "2018-01-01", categoryId: "1", categoryName: "Commissions (Purchase Price)", bankId: null, rentecOwnerId: null, vendorId: null, checkNum: null, pmtType: null, notes: null }],
      });
      const response = await POST(request());
      const body = await response.json();
      expect(body.batchPlan.eligibleByYear).toEqual([]);
      expect(body.batchPlan.heldBackCommissions).toEqual({ count: 1, amountCents: 11250000 });
    });
  });
});
