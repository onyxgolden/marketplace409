import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, PATCH } from "./route";

const paymentRow = (overrides = {}) => ({
  id: "rental_vendor_payment_1", vendor_id: "rental_vendor_1", payment_date: "2026-09-30",
  payment_method: "check", amount_cents: 25000, bank_account_id: "bank_1", check_number: "1042",
  memo: "", financial_event_ids: ["event_1"], status: "active", void_reason: null, voided_at: null,
  created_at: null, updated_at: null,
  ...overrides,
});

function singleBuilder(row) {
  const b = {
    select() { return b; }, eq() { return b; }, in() { return b; },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
    update() { return b; },
    then(resolve) { resolve({ data: [row], error: null }); },
  };
  return b;
}

function listBuilder(rows) {
  const b = {
    select() { return b; }, eq() { return b; }, in() { return b; },
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

const get = () => GET(new Request("https://t/"), { params: { id: "rental_vendor_payment_1" } });
const patch = (body) =>
  PATCH(new Request("https://t/", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "rental_vendor_payment_1" } });

function detailClient(payment, reconciliations = []) {
  return {
    rpc: vi.fn(),
    from: vi.fn((table) => {
      if (table === "rental_vendor_payments") return singleBuilder(payment);
      if (table === "rental_vendor_payment_applications") return listBuilder([]);
      if (table === "rental_vendors") return singleBuilder({ name: "Acme Plumbing" });
      if (table === "bank_reconciliations") return listBuilder(reconciliations);
      return listBuilder([]);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/vendor-payments/[id]", () => {
  it("returns the payment with its bill applications", async () => {
    const client = {
      from: vi.fn((table) => {
        if (table === "rental_vendor_payments") return singleBuilder(paymentRow());
        if (table === "rental_vendor_payment_applications") {
          return listBuilder([{
            payment_id: "rental_vendor_payment_1", bill_id: "rental_vendor_bill_1", amount_cents: 25000,
            rental_vendor_bills: { bill_date: "2026-09-15", due_date: "2026-10-15", amount_cents: 25000 },
          }]);
        }
        if (table === "rental_vendors") return singleBuilder({ name: "Acme Plumbing" });
        return listBuilder([]);
      }),
    };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payment).toMatchObject({ id: "rental_vendor_payment_1", vendorName: "Acme Plumbing" });
    expect(body.payment.applications).toHaveLength(1);
  });

  it("returns 404 for a missing payment", async () => {
    authAs(detailClient(null));
    const response = await get();
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/rental/vendor-payments/[id] — edit", () => {
  it("updates the memo on an active, unreconciled payment", async () => {
    const updated = paymentRow({ memo: "corrected" });
    const client = {
      rpc: vi.fn(),
      from: vi.fn((table) => {
        if (table === "rental_vendor_payments") {
          const b = singleBuilder(paymentRow());
          // The update path returns the updated row.
          b.update = () => singleBuilder(updated);
          return b;
        }
        if (table === "rental_vendor_payment_applications") return listBuilder([]);
        if (table === "rental_vendors") return singleBuilder({ name: "Acme Plumbing" });
        if (table === "bank_reconciliations") return listBuilder([]);
        return listBuilder([]);
      }),
    };
    authAs(client);
    const response = await patch({ memo: "corrected" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payment.memo).toBe("corrected");
  });

  it("blocks the edit when the payment is already reconciled", async () => {
    const client = detailClient(paymentRow(), [
      { status: "active", cleared_event_ids: ["event_1"] },
    ]);
    authAs(client);
    const response = await patch({ memo: "too late" });
    expect(response.status).toBe(409);
  });

  it("refuses to edit a voided payment", async () => {
    authAs(detailClient(paymentRow({ status: "voided" })));
    const response = await patch({ memo: "nope" });
    expect(response.status).toBe(409);
  });

  it("forbids read-only members from editing", async () => {
    authAs(detailClient(paymentRow()), "read_only");
    const response = await patch({ memo: "nope" });
    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/rental/vendor-payments/[id] — void", () => {
  it("voids through the RPC with a reason", async () => {
    const voided = paymentRow({ status: "voided", void_reason: "duplicate check" });
    const rpc = vi.fn().mockResolvedValue({ data: { paymentId: voided.id, reversedEvents: 1 }, error: null });
    let paymentReads = 0;
    const client = {
      rpc,
      from: vi.fn((table) => {
        if (table === "rental_vendor_payments") {
          // Pre-void check sees the active payment; the refresh sees it voided.
          paymentReads += 1;
          return singleBuilder(paymentReads === 1 ? paymentRow() : voided);
        }
        if (table === "rental_vendor_payment_applications") return listBuilder([]);
        if (table === "rental_vendors") return singleBuilder({ name: "Acme Plumbing" });
        return listBuilder([]);
      }),
    };
    authAs(client);
    const response = await patch({ void: true, voidReason: "duplicate check" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("void_vendor_payment", {
      p_owner_id: "owner_1",
      p_payment_id: "rental_vendor_payment_1",
      p_reason: "duplicate check",
    });
    expect(body.payment.status).toBe("voided");
    expect(body.reversedEvents).toBe(1);
  });

  it("requires a void reason", async () => {
    const client = detailClient(paymentRow());
    authAs(client);
    const response = await patch({ void: true, voidReason: "  " });
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps the RPC reconciliation guard to 409", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "This payment is already reconciled and cannot be voided." },
    });
    const client = detailClient(paymentRow());
    client.rpc = rpc;
    authAs(client);
    const response = await patch({ void: true, voidReason: "oops" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/reconciled/);
  });

  it("refuses to void an already-voided payment", async () => {
    const client = detailClient(paymentRow({ status: "voided" }));
    authAs(client);
    const response = await patch({ void: true, voidReason: "again" });
    expect(response.status).toBe(409);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
