import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/application/rental/checkRentalPaymentPolicy", () => ({
  checkRentalPaymentPolicy: vi.fn(async () => ({ ok: true })),
}));

import { recordOfflinePayment } from "./payments.js";

describe("recordOfflinePayment (follow-up G9)", () => {
  it("passes a personal check through to the RPC", async () => {
    const rpcCalls = [];
    const client = {
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        return { data: { id: "pay_1" }, error: null };
      },
    };
    const response = await recordOfflinePayment({
      authenticated: { supabaseClient: client, user: { id: "user_1" } },
      body: { payment: { chargeId: "charge_1", paymentMethod: "check", amountCents: 130000, receivedAt: "2026-09-01T00:00:00Z", tenantId: "tenant_1" } },
      effectiveOwnerId: "owner_1",
    });
    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ name: "record_offline_rental_payment", args: { p_payment_method: "check" } });
  });

  it("still rejects an unsupported method", async () => {
    const client = { rpc: vi.fn() };
    const response = await recordOfflinePayment({
      authenticated: { supabaseClient: client, user: { id: "user_1" } },
      body: { payment: { chargeId: "charge_1", paymentMethod: "barter", amountCents: 130000 } },
      effectiveOwnerId: "owner_1",
    });
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
