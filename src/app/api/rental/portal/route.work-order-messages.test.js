import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({ mode: "test" })),
}));
vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: vi.fn(async () => ({ user: { id: "auth_tenant_1" },
    supabaseClient: { rpc }, application: { load: vi.fn() } })),
}));
vi.mock("@/domains/rental-maintenance/workOrderMessagePing", () => ({
  buildWorkOrderMessageEventKey: vi.fn(({ messageId }) => `work-order-message:${messageId}`),
  buildWorkOrderMessagePing: vi.fn(() => ({ subject: "Ping subject", bodyText: "Ping body" })),
  queueWorkOrderMessagePing: vi.fn(),
}));

import { queueWorkOrderMessagePing } from "@/domains/rental-maintenance/workOrderMessagePing";
import { POST } from "./route.js";

function postRequest(body) {
  return new Request("https://example.test/api/rental/portal", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const tenantMessage = { conversationId: "conv_1", messageId: "m1", createdAt: "2026-09-30T12:00:00Z",
  tenantId: "tenant_1", workOrderId: "wo_1", ownerId: "owner_1", leaseId: "lease_1", tenantName: "Eric" };

describe("tenant portal work-order messaging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the work-order thread through the tenant rpc", async () => {
    rpc.mockResolvedValue({ data: { messages: [
      { id: "m1", sender_type: "owner", body: "Tech comes Thursday.", created_at: "2026-09-30T12:00:00Z" },
    ] }, error: null });
    const response = await POST(postRequest({ operation: "get-work-order-messages", workOrderId: "wo_1" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("read_rental_work_order_tenant_messages", { p_work_order_id: "wo_1" });
  });

  it("requires a work order id before reading", async () => {
    const response = await POST(postRequest({ operation: "get-work-order-messages" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the tenant message and pings the owner's email", async () => {
    rpc.mockImplementation((name) => {
      if (name === "send_rental_work_order_tenant_message") return Promise.resolve({ data: tenantMessage, error: null });
      if (name === "get_rental_owner_notification_email") return Promise.resolve({ data: "jason@example.com", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    queueWorkOrderMessagePing.mockResolvedValue({ notificationId: "n_1", recipient: "jason@example.com" });
    const response = await POST(postRequest({ operation: "send-work-order-message", workOrderId: "wo_1", body: "The part arrived." }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("send_rental_work_order_tenant_message",
      { p_work_order_id: "wo_1", p_body: "The part arrived." });
    expect(queueWorkOrderMessagePing).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner_1", tenantId: "tenant_1", leaseId: "lease_1",
      eventKey: "work-order-message:m1", recipient: "jason@example.com",
    }));
    // No-arg call: the RPC resolves the landlord from the caller's own tenant row.
    expect(rpc).toHaveBeenCalledWith("get_rental_owner_notification_email");
    expect(body.pinged).toBe(true);
    // The owner's email address is used server-side only -- it must never reach the tenant client.
    expect(JSON.stringify(body)).not.toContain("jason@example.com");
  });

  it("reports pinged false when the owner's email does not resolve", async () => {
    rpc.mockImplementation((name) => {
      if (name === "send_rental_work_order_tenant_message") return Promise.resolve({ data: tenantMessage, error: null });
      if (name === "get_rental_owner_notification_email") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const response = await POST(postRequest({ operation: "send-work-order-message", workOrderId: "wo_1", body: "The part arrived." }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(queueWorkOrderMessagePing).not.toHaveBeenCalled();
    expect(body.pinged).toBe(false);
  });

  it("rejects an empty message body before calling the database", async () => {
    const response = await POST(postRequest({ operation: "send-work-order-message", workOrderId: "wo_1", body: "  " }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a 500 when the tenant send rpc rejects", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Work order was not found.") });
    const response = await POST(postRequest({ operation: "send-work-order-message", workOrderId: "wo_9", body: "Hello" }));
    expect(response.status).toBe(500);
  });
});
