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

function request(body) {
  return new NextRequest("https://forge.test/api/rental/rentec-financial-history-import-approve", { method: "POST", body: JSON.stringify(body) });
}

function mockDatabase({ financialEvents = [], rpcImpl } = {}) {
  const rpc = vi.fn(rpcImpl || (async () => ({ data: { status: "applied", insertedCount: 1, skippedCount: 0 }, error: null })));
  return {
    from: (table) => {
      if (table === "financial_events") return { select: () => ({ eq: () => ({ range: () => Promise.resolve({ data: financialEvents, error: null }) }) }) };
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc,
  };
}

const oneProperty = { propertyIds: ["10"], propertyReferences: [{ id: "10", label: "1218 Wagner St" }] };

function rentecRow(overrides = {}) {
  return {
    transactionId: "500", splitId: null, propertyId: "10", renterId: "7", amountCents: 100000,
    transactionDate: "2021-04-01", categoryId: "9", categoryName: "Rental Income", bankId: null,
    rentecOwnerId: null, vendorId: null, checkNum: null, pmtType: null, notes: null, ...overrides,
  };
}

describe("rentec financial history import approve route", () => {
  beforeEach(() => { vi.clearAllMocks(); createAuthenticatedForgeApplication.mockResolvedValue(authenticated); });

  it("rejects unauthenticated callers, never calling Rentec", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce(unauthenticatedResponse);
    const response = await POST(request({ sourceRecordIds: ["500:none"] }));
    expect(response.status).toBe(401);
    expect(inventory).not.toHaveBeenCalled();
  });

  it("requires at least one sourceRecordId", async () => {
    const response = await POST(request({ sourceRecordIds: [] }));
    expect(response.status).toBe(400);
  });

  it("approves a fresh safe-missing row and calls the RPC with the recomputed financial_events row, not client-supplied facts", async () => {
    const rpc = vi.fn(async () => ({ data: { status: "applied", insertedCount: 1, skippedCount: 0 }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: rpc }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecRow()] });
    const response = await POST(request({ sourceRecordIds: ["500:none"], amount: 999999, transactionKind: "expense" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.insertedCount).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, params] = rpc.mock.calls[0];
    expect(params.p_owner_id).toBe("owner_1");
    expect(params.p_rows[0]).toMatchObject({ amount: 1000, transaction_kind: "income", source_record_id: "500:none" });
  });

  // RENTEC-01-FIX #1: a single Rentec row against two financially-identical existing legacy rows is
  // reconciled by count and comes back alreadyRepresented (not ambiguous) — but it's still correctly
  // rejected here, because alreadyRepresented rows are never bulk-approvable either, same as before.
  it("rejects a row that fresh reclassification resolves as alreadyRepresented, rather than approving it", async () => {
    const existingA = { id: "a", property_id: "1218-wagner-st", event_date: "2021-04-01", description: "Rental Income", amount: 1000, transaction_kind: "income", normalized_category: "rental_income", source_system: "rentec", source_record_id: "rentec-a", status: "active", is_deleted: false };
    const existingB = { ...existingA, id: "b", source_record_id: "rentec-b" };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ financialEvents: [existingA, existingB] }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecRow()] });
    const response = await POST(request({ sourceRecordIds: ["500:none"] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.insertedCount).toBe(0);
    expect(body.rejected).toEqual([{ sourceRecordId: "500:none", reason: expect.stringContaining("alreadyRepresented") }]);
  });

  // RENTEC-01-FIX #1: 2 Rentec rows against 1 existing legacy row - only one is genuinely missing.
  // Requesting approval for BOTH must approve exactly the one fresh reclassification calls
  // safeMissing, and reject the other (now alreadyRepresented), never both or neither.
  it("cardinality-safe reconciliation at approval time: of two identical Rentec rows against one existing row, exactly one is approved and the other rejected", async () => {
    const rpc = vi.fn(async () => ({ data: { status: "applied", insertedCount: 1, skippedCount: 0 }, error: null }));
    const existingA = { id: "a", property_id: "1218-wagner-st", event_date: "2021-04-01", description: "Rental Income", amount: 1000, transaction_kind: "income", normalized_category: "rental_income", source_system: "rentec", source_record_id: "rentec-a", status: "active", is_deleted: false };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ financialEvents: [existingA], rpcImpl: rpc }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [rentecRow({ transactionId: "500" }), rentecRow({ transactionId: "501" })],
    });
    const response = await POST(request({ sourceRecordIds: ["500:none", "501:none"] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.insertedCount).toBe(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toContain("alreadyRepresented");
  });

  it("rejects a conflict row rather than approving it", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecRow({ amountCents: -50000 })] });
    const response = await POST(request({ sourceRecordIds: ["500:none"] }));
    const body = await response.json();
    expect(body.insertedCount).toBe(0);
    expect(body.rejected[0].reason).toContain("conflict");
  });

  it("rejects a requested sourceRecordId that no longer appears in a fresh Rentec fetch", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    const response = await POST(request({ sourceRecordIds: ["500:none"] }));
    const body = await response.json();
    expect(body.insertedCount).toBe(0);
    expect(body.rejected[0].reason).toContain("no longer present");
  });

  it("never calls the RPC when nothing survives fresh reclassification as safe missing", async () => {
    const rpc = vi.fn();
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: rpc }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
    await POST(request({ sourceRecordIds: ["500:none"] }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("approving the same already-imported row again is a no-op, since a fresh fetch now classifies it as already represented", async () => {
    const alreadyImported = {
      id: "evt-2", source_system: "rentec_api", source_record_id: "500:none",
      property_id: "1218-wagner-st", event_date: "2021-04-01", amount: 1000, transaction_kind: "income", normalized_category: "rental_income",
      status: "active", is_deleted: false,
    };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ financialEvents: [alreadyImported] }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecRow()] });
    const response = await POST(request({ sourceRecordIds: ["500:none"] }));
    const body = await response.json();
    expect(body.insertedCount).toBe(0);
    expect(body.rejected[0].reason).toContain("alreadyRepresented");
  });

  it("keeps two splits of the same transaction as two separate approved rows", async () => {
    const rpc = vi.fn(async () => ({ data: { status: "applied", insertedCount: 2, skippedCount: 0 }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: rpc }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({
      page: 1, moreRecords: false,
      transactions: [rentecRow({ splitId: "1", amountCents: 80000 }), rentecRow({ splitId: "2", categoryName: "CAM Income", categoryId: "2", amountCents: 20000 })],
    });
    const response = await POST(request({ sourceRecordIds: ["500:1", "500:2"] }));
    const body = await response.json();
    expect(body.insertedCount).toBe(2);
    const [, params] = rpc.mock.calls[0];
    expect(params.p_rows.map((row) => row.source_record_id)).toEqual(["500:1", "500:2"]);
  });

  it("scopes the fresh financial_events re-read to the authenticated owner id", async () => {
    const eqCalls = [];
    const db = {
      from: (table) => { if (table === "financial_events") return { select: () => ({ eq: (...args) => { eqCalls.push(args); return { range: () => Promise.resolve({ data: [], error: null }) }; } }) }; throw new Error(table); },
      rpc: vi.fn(async () => ({ data: { status: "applied", insertedCount: 1, skippedCount: 0 }, error: null })),
    };
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: db });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecRow()] });
    await POST(request({ sourceRecordIds: ["500:none"] }));
    expect(eqCalls).toContainEqual(["owner_id", "owner_1"]);
  });

  it("concurrent approval: two overlapping approval calls for the same row both succeed, with the second converging to zero net inserts via the RPC's own on-conflict-do-nothing behavior", async () => {
    // The route never does its own read-then-write two-step insert — every approved row goes
    // through a single RPC call, so there is no app-level race window; the real concurrency
    // guarantee is financial_events' unique index plus the RPC's on-conflict-do-nothing (verified
    // in the migration test). This asserts the route handles that outcome gracefully rather than
    // erroring or double-counting when the RPC reports a row as already present.
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { status: "applied", insertedCount: 1, skippedCount: 0 }, error: null })
      .mockResolvedValueOnce({ data: { status: "applied", insertedCount: 0, skippedCount: 1 }, error: null });
    const db = mockDatabase({ rpcImpl: rpc });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...authenticated, supabaseClient: db });
    inventory.mockResolvedValue(oneProperty);
    financialHistoryTransactions.mockResolvedValue({ page: 1, moreRecords: false, transactions: [rentecRow()] });

    const [first, second] = await Promise.all([
      POST(request({ sourceRecordIds: ["500:none"] })),
      POST(request({ sourceRecordIds: ["500:none"] })),
    ]);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect([firstBody.insertedCount, secondBody.insertedCount].sort()).toEqual([0, 1]);
    expect([firstBody.skippedCount, secondBody.skippedCount].sort()).toEqual([0, 1]);
  });

  it("returns an error response if the RPC fails, without silently swallowing it", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: async () => ({ data: null, error: new Error("boom") }) }) });
    inventory.mockResolvedValueOnce(oneProperty);
    financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecRow()] });
    const response = await POST(request({ sourceRecordIds: ["500:none"] }));
    expect(response.status).toBe(500);
  });

  describe("Commissions exclusion (RENTEC-01-FIX follow-up: real-estate-purchase collision risk)", () => {
    it("rejects a Commissions-category row even though fresh classification says safeMissing, and never calls the RPC for it", async () => {
      const rpc = vi.fn();
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: rpc }) });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({
        page: 1, moreRecords: false,
        transactions: [rentecRow({ categoryName: "Commissions (Purchase Price)", categoryId: "1", amountCents: -11250000 })],
      });
      const response = await POST(request({ sourceRecordIds: ["500:none"] }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.insertedCount).toBe(0);
      expect(rpc).not.toHaveBeenCalled();
      expect(body.rejected).toEqual([{ sourceRecordId: "500:none", reason: expect.stringContaining("Commissions") }]);
    });

    it("approves a non-Commissions row in the same batch while rejecting the Commissions one", async () => {
      const rpc = vi.fn(async () => ({ data: { status: "applied", insertedCount: 1, skippedCount: 0 }, error: null }));
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: rpc }) });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({
        page: 1, moreRecords: false,
        transactions: [
          rentecRow({ transactionId: "500", categoryName: "Commissions", categoryId: "1", amountCents: -11250000 }),
          rentecRow({ transactionId: "501", categoryName: "Rental Income", categoryId: "9", amountCents: 100000 }),
        ],
      });
      const response = await POST(request({ sourceRecordIds: ["500:none", "501:none"] }));
      const body = await response.json();
      expect(body.insertedCount).toBe(1);
      expect(body.rejected).toEqual([{ sourceRecordId: "500:none", reason: expect.stringContaining("Commissions") }]);
      const [, params] = rpc.mock.calls[0];
      expect(params.p_rows).toHaveLength(1);
      expect(params.p_rows[0].source_record_id).toBe("501:none");
    });
  });

  describe("income/expense totals in the response", () => {
    it("reports the income and expense dollar totals of the rows sent to the RPC", async () => {
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({
        page: 1, moreRecords: false,
        transactions: [
          rentecRow({ transactionId: "500", categoryName: "Rental Income", categoryId: "9", amountCents: 100000 }),
          rentecRow({ transactionId: "501", categoryName: "Repairs", categoryId: "4", amountCents: -20000 }),
        ],
      });
      const response = await POST(request({ sourceRecordIds: ["500:none", "501:none"] }));
      const body = await response.json();
      expect(body.incomeCents).toBe(100000);
      expect(body.expenseCents).toBe(20000);
    });

    it("reports zero income/expense totals when nothing is approved", async () => {
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [] });
      const response = await POST(request({ sourceRecordIds: ["500:none"] }));
      const body = await response.json();
      expect(body.incomeCents).toBe(0);
      expect(body.expenseCents).toBe(0);
    });
  });

  describe("zero-amount exclusion (a $0 row would otherwise block the whole batch's RPC call)", () => {
    it("rejects a $0.00 row even though fresh classification says safeMissing, and never calls the RPC for it alone", async () => {
      const rpc = vi.fn();
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: rpc }) });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({ page: 1, moreRecords: false, transactions: [rentecRow({ amountCents: 0 })] });
      const response = await POST(request({ sourceRecordIds: ["500:none"] }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.insertedCount).toBe(0);
      expect(rpc).not.toHaveBeenCalled();
      expect(body.rejected).toEqual([{ sourceRecordId: "500:none", reason: expect.stringContaining("no positive amount") }]);
    });

    it("approves the rest of a batch while excluding only the $0.00 row within it", async () => {
      const rpc = vi.fn(async () => ({ data: { status: "applied", insertedCount: 1, skippedCount: 0 }, error: null }));
      createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({ rpcImpl: rpc }) });
      inventory.mockResolvedValueOnce(oneProperty);
      financialHistoryTransactions.mockResolvedValueOnce({
        page: 1, moreRecords: false,
        transactions: [
          rentecRow({ transactionId: "500", amountCents: 0 }),
          rentecRow({ transactionId: "501", amountCents: 100000 }),
        ],
      });
      const response = await POST(request({ sourceRecordIds: ["500:none", "501:none"] }));
      const body = await response.json();
      expect(body.insertedCount).toBe(1);
      expect(body.rejected).toEqual([{ sourceRecordId: "500:none", reason: expect.stringContaining("no positive amount") }]);
      const [, params] = rpc.mock.calls[0];
      expect(params.p_rows).toHaveLength(1);
      expect(params.p_rows[0].source_record_id).toBe("501:none");
    });
  });
});
