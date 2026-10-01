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

function clientFor({ paymentRow = payment, corrections = [correctionRow] } = {}) {
  return {
    from: vi.fn((table) => {
      if (table === "rental_payments") return chain(paymentRow);
      if (table === "rental_payment_corrections") return chain(corrections);
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

  it("404s for another workspace's payment", async () => {
    authAs(clientFor({ paymentRow: null }));
    expect((await get()).status).toBe(404);
  });
});
