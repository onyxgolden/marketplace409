import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET } from "./route";

const payment = {
  id: "rental_payment_1", charge_id: "rent_charge_1", lease_id: "lease_1", tenant_id: "tenant_1",
  provider: "offline", payment_method: "cash", amount_cents: 160000, refunded_amount_cents: 0,
  currency_code: "USD", status: "succeeded", received_at: "2026-09-01", succeeded_at: "2026-09-01",
  created_at: null, receipt_reference: null, notes: "September rent", recorded_by: "user_1",
};

const correctionRow = {
  id: "corr_1", payment_id: "rental_payment_1", corrected_at: "2026-10-01T00:00:00Z",
  corrected_by: "user_1", reason: "overpaid",
  changes: { amount_cents: { from: 160000, to: 150000 } },
  balance_delta_cents: -10000, reconciled_warning: false,
};

function chain(result) {
  const b = {
    select() { return b; },
    eq() { return b; },
    order() { return b; },
    maybeSingle() { return Promise.resolve({ data: result, error: null }); },
    then(resolve) { resolve({ data: Array.isArray(result) ? result : [], error: null }); },
  };
  return b;
}

const chargeRows = [
  { id: "rent_charge_1", period: "2026-09", due_date: "2026-09-01", amount_cents: 160000, paid_amount_cents: 160000, status: "paid", charge_type: "rent" },
  { id: "rent_charge_2", period: "2026-10", due_date: "2026-10-01", amount_cents: 160000, paid_amount_cents: 0, status: "due", charge_type: "rent" },
];

function clientFor({ paymentRow = payment, corrections = [correctionRow], charges = chargeRows } = {}) {
  return {
    from: vi.fn((table) => {
      if (table === "rental_payments") return chain(paymentRow);
      if (table === "rental_payment_corrections") return chain(corrections);
      if (table === "rent_charges") return chain(charges);
      return chain(null);
    }),
  };
}

function authAs(client) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
}

const get = () => GET(new Request("https://t/"), { params: { id: "rental_payment_1" } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/tenant-payments/[id]", () => {
  it("returns the payment with its correction history", async () => {
    authAs(clientFor());
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payment).toMatchObject({
      id: "rental_payment_1",
      correctable: true,
      moneyFieldsCorrectable: true,
    });
    expect(body.corrections).toHaveLength(1);
    expect(body.corrections[0]).toMatchObject({
      reason: "overpaid",
      balanceDeltaCents: -10000,
      changes: [{ field: "amount_cents", label: "Amount", from: 160000, to: 150000 }],
    });
  });

  it("marks provider-settled payments as notes-only", async () => {
    authAs(clientFor({ paymentRow: { ...payment, provider: "stripe", payment_method: "ach" } }));
    const body = await (await get()).json();
    expect(body.payment.correctable).toBe(true);
    expect(body.payment.moneyFieldsCorrectable).toBe(false);
  });

  it("returns the charge, lease, deposit state, and same-lease charges for the edit dialog", async () => {
    authAs(clientFor({ paymentRow: { ...payment, deposit_state: "received", deposit_amount_cents: 50000 } }));
    const body = await (await get()).json();
    expect(body.payment).toMatchObject({
      chargeId: "rent_charge_1",
      leaseId: "lease_1",
      depositState: "received",
      depositAmountCents: 50000,
    });
    expect(body.availableCharges).toEqual([
      { id: "rent_charge_1", period: "2026-09", dueDate: "2026-09-01", amountCents: 160000, paidAmountCents: 160000, status: "paid", chargeType: "rent" },
      { id: "rent_charge_2", period: "2026-10", dueDate: "2026-10-01", amountCents: 160000, paidAmountCents: 0, status: "due", chargeType: "rent" },
    ]);
  });

  it("404s for another workspace's payment", async () => {
    authAs(clientFor({ paymentRow: null }));
    expect((await get()).status).toBe(404);
  });
});
