import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST } from "./route";

// R18 (rentec-parity): re-issue a voided vendor payment.

const voided = {
  id: "rental_vendor_payment_1", vendor_id: "rental_vendor_1", payment_date: "2026-09-30",
  payment_method: "check", amount_cents: 25000, bank_account_id: null, check_number: "1042",
  memo: "plumbing", financial_event_ids: [], status: "voided",
  void_reason: "lost in the mail", voided_at: "2026-10-01",
  reissued_from_payment_id: null, created_at: null, updated_at: null,
};

const created = {
  ...voided,
  id: "rental_vendor_payment_2",
  payment_date: "2026-10-02",
  check_number: "1043",
  status: "active",
  void_reason: null,
  voided_at: null,
  reissued_from_payment_id: "rental_vendor_payment_1",
};

function chain(result) {
  const b = {
    select() { return b; },
    eq() { return b; },
    neq() { return b; },
    in() { return b; },
    order() { return b; },
    insert() { return Promise.resolve({ error: null }); },
    maybeSingle() { return Promise.resolve({ data: result, error: null }); },
    then(resolve) { resolve({ data: Array.isArray(result) ? result : [], error: null }); },
  };
  return b;
}

// Dispatches rental_vendor_payments calls:
//   - the supersession lookup (eq on reissued_from_payment_id) → existingReissue
//   - the first original lookup → paymentRow
//   - the created-payment refresh after the RPC → createdRow
function paymentsBuilder({ paymentRow, existingReissue, createdRow }) {
  let reads = 0;
  const b = {
    select() { return b; },
    eq(column) { b._supersession = b._supersession || column === "reissued_from_payment_id"; return b; },
    maybeSingle() {
      if (b._supersession) return Promise.resolve({ data: existingReissue, error: null });
      reads += 1;
      return Promise.resolve({ data: reads === 1 ? paymentRow : createdRow, error: null });
    },
  };
  return b;
}

function clientFor({
  paymentRow = voided,
  existingReissue = null,
  originalApps = [{ bill_id: "rental_vendor_bill_1", amount_cents: 25000 }],
  createdRow = created,
  rpcImpl = null,
} = {}) {
  const rpc = vi.fn();
  if (rpcImpl) rpc.mockImplementation(rpcImpl);
  else rpc.mockResolvedValue({ data: { paymentId: createdRow.id }, error: null });
  // Shared across from() calls: the original lookup, the refresh after the
  // RPC. The supersession lookup branches on its eq column instead.
  let reads = 0;
  return {
    rpc,
    from: vi.fn((table) => {
      if (table === "rental_vendor_payments") {
        const b = {
          select() { return b; },
          eq(column) { b._supersession = b._supersession || column === "reissued_from_payment_id"; return b; },
          maybeSingle() {
            if (b._supersession) return Promise.resolve({ data: existingReissue, error: null });
            reads += 1;
            return Promise.resolve({ data: reads === 1 ? paymentRow : createdRow, error: null });
          },
        };
        return b;
      }
      if (table === "rental_vendor_payment_applications") return chain(originalApps);
      if (table === "rental_vendors") return chain({ name: "Acme Plumbing" });
      if (table === "rental_void_audits") return chain([]);
      return chain([]);
    }),
  };
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const post = (body) =>
  POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }), {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/vendor-payments/reissue", () => {
  it("forbids read-only members", async () => {
    const client = clientFor();
    authAs(client, "read_only");
    const response = await post({ voidedPaymentId: voided.id, checkNumber: "1043", reason: "lost" });
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("requires the voided payment id", async () => {
    const client = clientFor();
    authAs(client);
    expect((await post({ checkNumber: "1043", reason: "x" })).status).toBe(400);
  });

  it("404s when the payment is not found", async () => {
    const client = clientFor({ paymentRow: null });
    authAs(client);
    expect((await post({ voidedPaymentId: "missing", checkNumber: "1043", reason: "x" })).status).toBe(404);
  });

  it("409s when the payment is not voided", async () => {
    const client = clientFor({ paymentRow: { ...voided, status: "active" } });
    authAs(client);
    const response = await post({ voidedPaymentId: voided.id, checkNumber: "1043", reason: "x" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/voided/i);
  });

  it("requires a reason", async () => {
    const client = clientFor();
    authAs(client);
    expect((await post({ voidedPaymentId: voided.id, checkNumber: "1043" })).status).toBe(400);
  });

  it("blocks reusing the voided check's number", async () => {
    const client = clientFor();
    authAs(client);
    const response = await post({ voidedPaymentId: voided.id, checkNumber: "1042", reason: "lost" });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/cannot reuse/i);
  });

  it("409s when a live re-issue already exists (supersession guard)", async () => {
    const client = clientFor({
      existingReissue: { id: "rental_vendor_payment_9", check_number: "1043", payment_date: "2026-10-02" },
    });
    authAs(client);
    const response = await post({ voidedPaymentId: voided.id, checkNumber: "1044", reason: "lost again" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/already re-issued/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("409s when the voided payment has no bill lines", async () => {
    const client = clientFor({ originalApps: [] });
    authAs(client);
    const response = await post({ voidedPaymentId: voided.id, checkNumber: "1043", reason: "lost" });
    expect(response.status).toBe(409);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("re-issues through the record RPC and links the new payment", async () => {
    const client = clientFor();
    authAs(client);
    const response = await post({ voidedPaymentId: voided.id, checkNumber: "1043", paymentDate: "2026-10-02", memo: "reprint", reason: "lost in mail" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("record_vendor_payment", expect.objectContaining({
      p_owner_id: "owner_1",
    }));
    const paymentArg = client.rpc.mock.calls[0][1].p_payment;
    expect(paymentArg).toMatchObject({
      vendorId: "rental_vendor_1",
      paymentMethod: "check",
      checkNumber: "1043",
      amountCents: 25000,
      reissuedFrom: "rental_vendor_payment_1",
    });
    expect(body).toMatchObject({ success: true, reissuedFromPaymentId: "rental_vendor_payment_1" });
    expect(body.payment).toMatchObject({
      id: "rental_vendor_payment_2",
      reissuedFromPaymentId: "rental_vendor_payment_1",
      vendorName: "Acme Plumbing",
    });
  });

  it("maps the RPC double re-issue race to 409", async () => {
    const client = clientFor({
      rpcImpl: () => Promise.resolve({
        data: null,
        error: { code: "P0001", message: "This payment already has a live re-issue." },
      }),
    });
    authAs(client);
    const response = await post({ voidedPaymentId: voided.id, checkNumber: "1043", reason: "lost" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/already re-issued/i);
  });
});
