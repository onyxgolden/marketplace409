import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

const bill = {
  id: "rental_vendor_bill_1", vendor_id: "rental_vendor_1", status: "open",
  amount_cents: 25000, paid_amount_cents: 0,
};

const paymentRow = {
  id: "rental_vendor_payment_1", vendor_id: "rental_vendor_1", payment_date: "2026-09-30",
  payment_method: "check", amount_cents: 25000, bank_account_id: "bank_1", check_number: "1042",
  memo: "", financial_event_ids: ["event_1"], status: "active", void_reason: null, voided_at: null,
  created_at: null, updated_at: null,
};

const goodBody = {
  id: "rental_vendor_payment_1",
  vendorId: "rental_vendor_1",
  paymentDate: "2026-09-30",
  paymentMethod: "check",
  checkNumber: "1042",
  bankAccountId: "bank_1",
  amountCents: 25000,
  applications: [{ billId: "rental_vendor_bill_1", amountCents: 25000 }],
};

function listBuilder(rows) {
  const b = {
    select() { return b; }, eq() { return b; }, order() { return b; }, in() { return b; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function singleBuilder(row) {
  const b = {
    select() { return b; }, eq() { return b; },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
  };
  return b;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const get = (query = "") => GET(new Request(`https://t/${query}`));
const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/vendor-payments", () => {
  it("lists payments with vendor names and bill applications joined in", async () => {
    const client = {
      from: vi.fn((table) => {
        if (table === "rental_vendor_payments") return listBuilder([paymentRow]);
        if (table === "rental_vendor_payment_applications") {
          return listBuilder([{
            payment_id: "rental_vendor_payment_1", bill_id: "rental_vendor_bill_1", amount_cents: 25000,
            rental_vendor_bills: { bill_date: "2026-09-15", due_date: "2026-10-15", amount_cents: 25000 },
          }]);
        }
        return listBuilder([{ id: "rental_vendor_1", name: "Acme Plumbing" }]);
      }),
    };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ vendorName: "Acme Plumbing", amountCents: 25000, status: "active" });
    expect(body.payments[0].applications).toEqual([
      { billId: "rental_vendor_bill_1", amountCents: 25000, billBillDate: "2026-09-15", billDueDate: "2026-10-15", billAmountCents: 25000 },
    ]);
  });

  it("applies the status filter", async () => {
    const from = vi.fn((table) => listBuilder(table === "rental_vendor_payments" ? [] : []));
    authAs({ from });
    await get("?status=voided");
    const paymentsQuery = from.mock.calls.find(([table]) => table === "rental_vendor_payments");
    expect(paymentsQuery).toBeTruthy();
  });
});

describe("POST /api/rental/vendor-payments", () => {
  it("records a payment through the atomic RPC and returns 201", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { paymentId: paymentRow.id, eventIds: ["event_1"] }, error: null });
    let paymentReads = 0;
    const client = {
      rpc,
      from: vi.fn((table) => {
        if (table === "rental_vendor_bills") return listBuilder([bill]);
        if (table === "rental_vendor_payments") {
          paymentReads += 1;
          // Pre-check: no existing payment. Post-RPC fetch: the new row.
          return singleBuilder(paymentReads === 1 ? null : paymentRow);
        }
        if (table === "rental_vendor_payment_applications") return listBuilder([]);
        return listBuilder([{ id: "rental_vendor_1", name: "Acme Plumbing" }]);
      }),
    };
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.payment).toMatchObject({ id: paymentRow.id, amountCents: 25000, status: "active" });
    expect(rpc).toHaveBeenCalledWith("record_vendor_payment", {
      p_owner_id: "owner_1",
      p_payment: expect.objectContaining({
        id: "rental_vendor_payment_1",
        vendorId: "rental_vendor_1",
        paymentMethod: "check",
        checkNumber: "1042",
        amountCents: 25000,
        applications: [{ billId: "rental_vendor_bill_1", amountCents: 25000 }],
      }),
    });
  });

  it("returns the existing payment instead of double-posting on retry", async () => {
    const rpc = vi.fn();
    const client = {
      rpc,
      from: vi.fn((table) => {
        if (table === "rental_vendor_bills") return listBuilder([bill]);
        if (table === "rental_vendor_payments") return singleBuilder(paymentRow);
        if (table === "rental_vendor_payment_applications") return listBuilder([]);
        return listBuilder([{ id: "rental_vendor_1", name: "Acme Plumbing" }]);
      }),
    };
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deduplicated).toBe(true);
    expect(body.payment.id).toBe(paymentRow.id);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("survives a lost race with a concurrent identical submit", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    let paymentReads = 0;
    const client = {
      rpc,
      from: vi.fn((table) => {
        if (table === "rental_vendor_bills") return listBuilder([bill]);
        if (table === "rental_vendor_payments") {
          paymentReads += 1;
          return singleBuilder(paymentReads === 1 ? null : paymentRow);
        }
        if (table === "rental_vendor_payment_applications") return listBuilder([]);
        return listBuilder([{ id: "rental_vendor_1", name: "Acme Plumbing" }]);
      }),
    };
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deduplicated).toBe(true);
  });

  it("rejects an overpayment with a 400 and never calls the RPC", async () => {
    const rpc = vi.fn();
    const client = {
      rpc,
      from: vi.fn(() => listBuilder([bill])),
    };
    authAs(client);
    const response = await post({
      ...goodBody,
      amountCents: 30000,
      applications: [{ billId: "rental_vendor_bill_1", amountCents: 30000 }],
    });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a check payment without a check number", async () => {
    const rpc = vi.fn();
    authAs({ rpc, from: vi.fn(() => listBuilder([bill])) });
    const response = await post({ ...goodBody, checkNumber: "" });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps RPC validation failures to 400", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "22023", message: "The payment exceeds the bill balance." } });
    const client = {
      rpc,
      from: vi.fn((table) => (table === "rental_vendor_bills" ? listBuilder([bill]) : singleBuilder(null))),
    };
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/bill balance/);
  });

  it("forbids read-only members from posting", async () => {
    const client = { from: vi.fn() };
    authAs(client, "read_only");
    const response = await post(goodBody);
    expect(response.status).toBe(403);
  });
});
