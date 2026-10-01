import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST } from "./route";

const receipt = {
  id: "rental_receipt_abc123",
  vendor_id: "rental_vendor_1",
  vendor_name_hint: null,
  receipt_date: "2026-09-15",
  amount_cents: 25000,
  status: "inbox",
};

const bill = {
  id: "rental_vendor_bill_1",
  vendor_id: "rental_vendor_1",
  amount_cents: 25000,
  paid_amount_cents: 0,
  status: "open",
};

function queryBuilder(rows) {
  const b = {
    select() { return b; },
    eq() { return b; },
    order() { return b; },
    update() { return b; },
    maybeSingle() { return Promise.resolve({ data: rows && rows.length > 0 ? rows[0] : null, error: null }); },
    single() { return Promise.resolve({ data: rows && rows.length > 0 ? rows[0] : null, error: null }); },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const apply = (receiptId, body) =>
  POST(new Request(`https://t/${receiptId}`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: receiptId }),
  });

const goodBody = { billId: bill.id, bankAccountId: "bank_1", paymentMethod: "ach" };

// Client whose `from` also records every update() call, so tests can prove
// the route never touches rental_receipts directly — the wrapper RPC owns the
// receipt linkage inside its own transaction.
function trackingClient({ receiptRow = receipt, billRow = bill, rpcImpl } = {}) {
  const updates = [];
  const rpc = rpcImpl || vi.fn().mockResolvedValue({
    data: { paymentId: "rental_vendor_payment_x", receiptId: receipt.id, billId: bill.id, appliedAmountCents: 25000 },
    error: null,
  });
  const client = {
    rpc,
    from: vi.fn((table) => {
      const b = queryBuilder(table === "rental_receipts" ? [receiptRow] : [billRow]);
      const originalUpdate = b.update.bind(b);
      b.update = (patch) => {
        updates.push({ table, patch });
        return originalUpdate(patch);
      };
      return b;
    }),
  };
  return { client, rpc, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/receipts/[id]/apply", () => {
  it("403s for read-only members", async () => {
    const { client, rpc } = trackingClient();
    authAs(client, "read_only");
    expect((await apply(receipt.id, goodBody)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s without a bill", async () => {
    const { client, rpc } = trackingClient();
    authAs(client);
    expect((await apply(receipt.id, { bankAccountId: "bank_1", paymentMethod: "ach" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s on an invalid receipt id", async () => {
    const { client, rpc } = trackingClient();
    authAs(client);
    expect((await apply("bogus", goodBody)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("409s when the receipt is already applied", async () => {
    const { client, rpc } = trackingClient({ receiptRow: { ...receipt, status: "applied" } });
    authAs(client);
    const response = await apply(receipt.id, goodBody);
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s when the receipt vendor does not match the bill vendor", async () => {
    const { client, rpc } = trackingClient({ billRow: { ...bill, vendor_id: "rental_vendor_9" } });
    authAs(client);
    const response = await apply(receipt.id, goodBody);
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("applies through the atomic apply_receipt_to_bill RPC — one call, no separate receipt update", async () => {
    const { client, rpc, updates } = trackingClient();
    authAs(client);

    const response = await apply(receipt.id, goodBody);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, receiptId: receipt.id, billId: bill.id, appliedAmountCents: 25000 });

    // Exactly one database call carries the whole operation: receipt lock +
    // R4 payment + receipt linkage inside one transaction.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("apply_receipt_to_bill");
    const args = rpc.mock.calls[0][1];
    expect(args.p_owner_id).toBe("owner_1");
    expect(args.p_receipt_id).toBe(receipt.id);
    const payload = args.p_payment;
    expect(payload.vendorId).toBe("rental_vendor_1");
    expect(payload.amountCents).toBe(25000);
    expect(payload.applications).toEqual([{ billId: bill.id, amountCents: 25000 }]);

    // The route never updates rental_receipts itself — the RPC owns the
    // linkage, so a failed RPC cannot leave payment-without-linkage.
    expect(updates).toHaveLength(0);
  });

  it("400s when the receipt total is less than the bill balance", async () => {
    const { client, rpc } = trackingClient({ receiptRow: { ...receipt, amount_cents: 10000 } });
    authAs(client);
    const response = await apply(receipt.id, goodBody);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/does not match the bill's remaining balance/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s when the receipt total EXCEEDS the bill balance — the $300/$250 regression", async () => {
    // ChatGPT NO-GO finding 1: a $300 receipt against a $250 remaining bill
    // must not record a $250 payment and mark the $300 receipt fully applied.
    const { client, rpc, updates } = trackingClient({
      receiptRow: { ...receipt, amount_cents: 30000 },
      billRow: { ...bill, amount_cents: 25000, paid_amount_cents: 0 },
    });
    authAs(client);
    const response = await apply(receipt.id, goodBody);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/does not match the bill's remaining balance/i);
    expect(body.error).toMatch(/split application is not supported/i);
    // No payment recorded, no receipt touched: the $50 cannot disappear.
    expect(rpc).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("maps the wrapper's split-required rejection to a 400, not a 500", async () => {
    // The RPC re-checks the exact-match rule under row locks: a balance that
    // moved between the app precheck and the RPC surfaces as a clear 400.
    const splitError = {
      code: "22023",
      message:
        "SPLIT_REQUIRED: the receipt total does not equal the bill's remaining balance. " +
        "Split application is not supported yet — pay the bill from the vendor payment screen instead; " +
        "the receipt stays in the inbox.",
    };
    const { client, rpc } = trackingClient({ rpcImpl: vi.fn().mockResolvedValue({ data: null, error: splitError }) });
    authAs(client);
    const response = await apply(receipt.id, goodBody);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/SPLIT_REQUIRED/);
  });

  it("a failed RPC leaves no partial state to reconcile", async () => {
    // Finding 2's failure mode: payment committed but receipt update failed.
    // With one atomic RPC, a rejection means nothing committed — the route
    // reports the failure and there is no half-done operation.
    const { client, rpc, updates } = trackingClient({
      rpcImpl: vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "could not serialize access" } }),
    });
    authAs(client);
    const response = await apply(receipt.id, goodBody);
    expect(response.status).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
    // The only write path is the single RPC — there is no separate receipt
    // update that could fail after a payment committed.
    expect(updates).toHaveLength(0);
  });

  it("a second apply of the same receipt is rejected before any payment", async () => {
    // The RPC locks the receipt row: after the first apply commits, a retry
    // sees status <> 'inbox' and is rejected without recording a payment.
    const { client, rpc } = trackingClient({ receiptRow: { ...receipt, status: "applied" } });
    authAs(client);
    const response = await apply(receipt.id, goodBody);
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
});
