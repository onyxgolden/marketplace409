import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST } from "./route";

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
    limit() { return b; },
    maybeSingle() { return Promise.resolve({ data: result, error: null }); },
    then(resolve) { resolve({ data: Array.isArray(result) ? result : [], error: null }); },
  };
  return b;
}

function clientFor({ paymentRow = payment, rpcResult = null, rpcError = null, corrections = [correctionRow] } = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: rpcResult || { correctionId: "corr_1", balanceDeltaCents: -10000, reconciledWarning: false },
      error: rpcError,
    }),
    from: vi.fn((table) => {
      if (table === "rental_payments") return chain(paymentRow);
      if (table === "rental_payment_corrections") return chain(corrections);
      return chain(null);
    }),
  };
}

function authAs(client, role = null) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const post = (body) =>
  POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }), { params: { id: "rental_payment_1" } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/tenant-payments/[id]/correct", () => {
  it("corrects the amount and returns the audit trail", async () => {
    const client = clientFor();
    authAs(client);
    const response = await post({ amountCents: 150000, reason: "overpaid" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("correct_rental_payment", expect.objectContaining({
      p_owner_id: "owner_1",
      p_payment_id: "rental_payment_1",
      p_changes: { amountCents: 150000 },
      p_reason: "overpaid",
    }));
    expect(body.correction).toMatchObject({
      reason: "overpaid",
      balanceDeltaCents: -10000,
      changes: [{ field: "amount_cents", from: 160000, to: 150000 }],
    });
  });

  it("forbids read-only members", async () => {
    const client = clientFor();
    authAs(client, "read_only");
    const response = await post({ notes: "x", reason: "y" });
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("allows co-owners", async () => {
    const client = clientFor();
    authAs(client, "co_owner");
    expect((await post({ notes: "clarify", reason: "typo" })).status).toBe(200);
  });

  it("404s for a missing payment", async () => {
    const client = clientFor({ paymentRow: null });
    authAs(client);
    expect((await post({ notes: "x", reason: "y" })).status).toBe(404);
  });

  it("requires a reason", async () => {
    const client = clientFor();
    authAs(client);
    const response = await post({ notes: "x" });
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects non-positive amounts", async () => {
    const client = clientFor();
    authAs(client);
    const response = await post({ amountCents: 0, reason: "bad" });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/positive/i);
  });

  it("blocks amount changes on provider-settled payments", async () => {
    const client = clientFor({ paymentRow: { ...payment, provider: "stripe", payment_method: "ach" } });
    authAs(client);
    const response = await post({ amountCents: 150000, reason: "overpaid" });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/provider-settled/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("blocks amount changes on refunded payments", async () => {
    const client = clientFor({ paymentRow: { ...payment, refunded_amount_cents: 160000 } });
    authAs(client);
    const response = await post({ amountCents: 150000, reason: "nope" });
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("409s when the payment is not completed", async () => {
    const client = clientFor({ paymentRow: { ...payment, status: "failed" } });
    authAs(client);
    const response = await post({ notes: "x", reason: "y" });
    expect(response.status).toBe(409);
  });

  it("maps the RPC reconciliation guard to 409", async () => {
    const client = clientFor({
      rpcResult: null,
      rpcError: { code: "P0001", message: "This payment is already reconciled and cannot be corrected." },
    });
    authAs(client);
    const response = await post({ amountCents: 150000, reason: "overpaid" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/reconciled/i);
  });

  it("maps the RPC credit-applications guard to 409", async () => {
    const client = clientFor({
      rpcResult: null,
      rpcError: {
        code: "P0001",
        message:
          "Part of this payment's overpayment credit ($60.00) has already been applied to other charges, " +
          "and the corrected amount leaves only $30.00 of excess to cover it. Correct to an amount that keeps " +
          "at least $60.00 of excess, or reverse the credit applications first.",
      },
    });
    authAs(client);
    const response = await post({ amountCents: 163000, reason: "overpaid" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/credit applications/i);
  });
});
