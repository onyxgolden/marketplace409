import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.js";

const { changeFrequencyRpc } = vi.hoisted(() => ({ changeFrequencyRpc: vi.fn() }));

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: vi.fn(() => { throw new Error("webhook client must not be used for change-payment-frequency"); }),
}));

vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: vi.fn(async () => ({
    user: { id: "tenant-user" },
    supabaseClient: { rpc: changeFrequencyRpc },
  })),
}));

async function call(body) {
  const req = { headers: new Headers(), json: async () => body };
  const res = await POST(req);
  return { status: res.status, payload: await res.json() };
}

beforeEach(() => { changeFrequencyRpc.mockReset(); });

describe("portal change-payment-frequency (atomic RPC)", () => {
  it("validates input shape before any database call", async () => {
    const noLease = await call({ operation: "change-payment-frequency", leaseId: " ", paymentFrequency: "weekly" });
    expect(noLease.status).toBe(400);
    expect(noLease.payload.error).toBe("leaseId is required.");
    const badFrequency = await call({ operation: "change-payment-frequency", leaseId: "lease-1", paymentFrequency: "daily" });
    expect(badFrequency.status).toBe(400);
    expect(badFrequency.payload.error).toContain("weekly, biweekly, or monthly");
    expect(changeFrequencyRpc).not.toHaveBeenCalled();
  });

  it("passes lease + frequency through to the atomic RPC as a single call", async () => {
    changeFrequencyRpc.mockResolvedValue({
      data: { success: true, schedule: { id: "schedule-1", payment_frequency: "weekly" },
        notification: { conversationId: "conv-1", messageId: "msg-1" } }, error: null,
    });
    const res = await call({ operation: "change-payment-frequency", leaseId: " lease-1 ", paymentFrequency: "weekly" });
    expect(changeFrequencyRpc).toHaveBeenCalledTimes(1);
    expect(changeFrequencyRpc).toHaveBeenCalledWith("change_rental_payment_frequency",
      { p_lease_id: "lease-1", p_payment_frequency: "weekly" });
    expect(res.status).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.schedule.payment_frequency).toBe("weekly");
  });

  it("surfaces the no-op unchanged result from the RPC", async () => {
    changeFrequencyRpc.mockResolvedValue({
      data: { success: true, unchanged: true, schedule: { id: "schedule-1" } }, error: null,
    });
    const res = await call({ operation: "change-payment-frequency", leaseId: "lease-1", paymentFrequency: "monthly" });
    expect(res.status).toBe(200);
    expect(res.payload.unchanged).toBe(true);
  });

  it("maps auth/permission failures (42501) to 403", async () => {
    changeFrequencyRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "The landlord has disabled payment schedule changes in the portal." },
    });
    const res = await call({ operation: "change-payment-frequency", leaseId: "lease-1", paymentFrequency: "weekly" });
    expect(res.status).toBe(403);
    expect(res.payload.error).toContain("disabled payment schedule changes");
  });

  it("maps unknown-lease (P0002) to 403 without leaking", async () => {
    changeFrequencyRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "This lease was not found." } });
    const res = await call({ operation: "change-payment-frequency", leaseId: "lease-1", paymentFrequency: "weekly" });
    expect(res.status).toBe(403);
    expect(res.payload.error).toBe("This lease was not found.");
  });

  it("maps missing active schedule (P0002) to 409", async () => {
    changeFrequencyRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "No active rent schedule was found for this lease." } });
    const res = await call({ operation: "change-payment-frequency", leaseId: "lease-1", paymentFrequency: "weekly" });
    expect(res.status).toBe(409);
    expect(res.payload.error).toContain("No active rent schedule");
  });

  it("throws unexpected RPC errors to the shared 500 handler", async () => {
    changeFrequencyRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal blowup" } });
    const res = await call({ operation: "change-payment-frequency", leaseId: "lease-1", paymentFrequency: "weekly" });
    expect(res.status).toBe(500);
  });
});
