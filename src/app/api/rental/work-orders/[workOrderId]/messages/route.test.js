import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(),
}));
vi.mock("@/domains/rental-maintenance/workOrderMessagePing", () => ({
  buildWorkOrderMessageEventKey: vi.fn(({ messageId }) => `work-order-message:${messageId}`),
  buildWorkOrderMessagePing: vi.fn(() => ({ subject: "Ping subject", bodyText: "Ping body" })),
  queueWorkOrderMessagePing: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { queueWorkOrderMessagePing } from "@/domains/rental-maintenance/workOrderMessagePing";
import { GET, POST } from "./route.js";

function chain(result) {
  const value = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  value.order.mockReturnValue(value);
  value.limit.mockResolvedValue(result);
  value.maybeSingle.mockResolvedValue(result);
  return value;
}

function ownerSession(tables, rpc) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1",
    supabaseClient: { from: (table) => tables[table], rpc },
  });
  getActiveWorkspaceRole.mockResolvedValue("owner");
}
function params() { return { params: Promise.resolve({ workOrderId: "wo_1" }) }; }
function postRequest(body) {
  return new Request("http://localhost/api/rental/work-orders/wo_1/messages",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("owner work-order message thread route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the work-order thread oldest first and marks it read by the owner", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    ownerSession({
      rental_maintenance_work_orders: chain({ data: { id: "wo_1", request_id: "req_1" }, error: null }),
      rental_conversations: chain({ data: { id: "conv_1" }, error: null }),
      rental_conversation_messages: chain({ data: [
        { id: "m1", sender_type: "tenant", body: "The part arrived.", created_at: "2026-09-30T11:00:00Z" },
        { id: "m2", sender_type: "owner", body: "Tech comes Thursday.", created_at: "2026-09-30T12:00:00Z" },
      ], error: null }),
    }, rpc);
    const response = await GET(new Request("http://localhost"), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.messages).toEqual([
      { id: "m1", senderType: "tenant", body: "The part arrived.", createdAt: "2026-09-30T11:00:00Z" },
      { id: "m2", senderType: "owner", body: "Tech comes Thursday.", createdAt: "2026-09-30T12:00:00Z" },
    ]);
    expect(rpc).toHaveBeenCalledWith("mark_rental_work_order_read_by_owner", { p_work_order_id: "wo_1" });
  });

  it("returns an empty thread without marking read when the work order has no thread yet", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    ownerSession({
      rental_maintenance_work_orders: chain({ data: { id: "wo_1", request_id: "req_1" }, error: null }),
      rental_conversations: chain({ data: null, error: null }),
    }, rpc);
    const response = await GET(new Request("http://localhost"), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.messages).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s when the work order does not belong to this owner", async () => {
    const rpc = vi.fn();
    ownerSession({ rental_maintenance_work_orders: chain({ data: null, error: null }) }, rpc);
    const response = await GET(new Request("http://localhost"), params());
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects read-only members on POST", async () => {
    const rpc = vi.fn();
    ownerSession({ rental_maintenance_work_orders: chain({ data: { id: "wo_1", request_id: "req_1" }, error: null }) }, rpc);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const response = await POST(postRequest({ body: "Hello" }), params());
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty message body before calling the database", async () => {
    const rpc = vi.fn();
    ownerSession({ rental_maintenance_work_orders: chain({ data: { id: "wo_1", request_id: "req_1" }, error: null }) }, rpc);
    const response = await POST(postRequest({ body: "   " }), params());
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the owner message and pings the tenant's email", async () => {
    const rpc = vi.fn(async (name) => {
      if (name === "send_rental_work_order_owner_message")
        return { data: { messageId: "m9", tenantId: "tenant_1", workOrderId: "wo_1" }, error: null };
      return { data: null, error: null };
    });
    queueWorkOrderMessagePing.mockResolvedValue({ notificationId: "n_1", recipient: "brandy@example.com" });
    ownerSession({
      rental_maintenance_work_orders: chain({ data: { id: "wo_1", request_id: "req_1" }, error: null }),
      rental_tenants: chain({ data: { id: "tenant_1", display_name: "Brandy", email: "brandy@example.com" }, error: null }),
      rental_maintenance_requests: chain({ data: { id: "req_1", lease_id: "lease_1", title: "Sink leak" }, error: null }),
    }, rpc);
    const response = await POST(postRequest({ body: "Tech comes Thursday." }), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("send_rental_work_order_owner_message",
      { p_work_order_id: "wo_1", p_body: "Tech comes Thursday." });
    expect(queueWorkOrderMessagePing).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner_1", tenantId: "tenant_1", leaseId: "lease_1",
      eventKey: "work-order-message:m9", recipient: "brandy@example.com",
    }));
    expect(body.ping).toEqual({ notificationId: "n_1", recipient: "brandy@example.com" });
  });

  it("sends the message without a ping when the tenant has no email on file", async () => {
    const rpc = vi.fn(async () => ({ data: { messageId: "m9", tenantId: "tenant_1", workOrderId: "wo_1" }, error: null }));
    ownerSession({
      rental_maintenance_work_orders: chain({ data: { id: "wo_1", request_id: "req_1" }, error: null }),
      rental_tenants: chain({ data: { id: "tenant_1", display_name: "Brandy", email: null }, error: null }),
      rental_maintenance_requests: chain({ data: { id: "req_1", lease_id: "lease_1", title: "Sink leak" }, error: null }),
    }, rpc);
    const response = await POST(postRequest({ body: "Tech comes Thursday." }), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(queueWorkOrderMessagePing).not.toHaveBeenCalled();
    expect(body.ping).toBeNull();
  });

  it("surfaces a 500 when the send RPC rejects", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: new Error("Tenant was not found.") }));
    ownerSession({ rental_maintenance_work_orders: chain({ data: { id: "wo_1", request_id: "req_1" }, error: null }) }, rpc);
    const response = await POST(postRequest({ body: "Hello" }), params());
    expect(response.status).toBe(500);
  });
});
