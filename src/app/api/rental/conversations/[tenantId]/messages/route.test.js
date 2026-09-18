import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
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

function request(body) {
  return new Request("http://localhost/api/rental/conversations/tenant_1/messages", { method: "POST", body: JSON.stringify(body) });
}
function params() { return { params: Promise.resolve({ tenantId: "tenant_1" }) }; }

describe("owner conversation thread route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the full message thread for the tenant's conversation, oldest first", async () => {
    const conversationTable = chain({ data: { id: "conversation_1" }, error: null });
    const messagesTable = chain({ data: [
      { id: "m1", sender_type: "tenant", body: "The heater is not working.", category: "issue", created_at: "2026-09-05T11:00:00Z" },
      { id: "m2", sender_type: "owner", body: "Sending someone tomorrow.", category: null, created_at: "2026-09-05T12:00:00Z" },
    ], error: null });
    const tables = { rental_conversations: conversationTable, rental_conversation_messages: messagesTable };
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ supabaseClient: { from: (table) => tables[table], rpc } });
    const response = await GET(new Request("http://localhost"), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.messages).toEqual([
      { id: "m1", senderType: "tenant", body: "The heater is not working.", category: "issue", createdAt: "2026-09-05T11:00:00Z" },
      { id: "m2", senderType: "owner", body: "Sending someone tomorrow.", category: null, createdAt: "2026-09-05T12:00:00Z" },
    ]);
    expect(rpc).toHaveBeenCalledWith("mark_rental_conversation_read_by_owner", { p_tenant_id: "tenant_1" });
  });

  it("returns an empty thread (and never marks a non-existent conversation read) when the tenant has never messaged", async () => {
    const conversationTable = chain({ data: null, error: null });
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ supabaseClient: { from: () => conversationTable, rpc } });
    const response = await GET(new Request("http://localhost"), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.messages).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends an owner message through the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { conversationId: "conversation_1", messageId: "m3" }, error: null }));
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ supabaseClient: { rpc } });
    const response = await POST(request({ body: "Following up on this." }), params());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("send_rental_conversation_owner_message", { p_tenant_id: "tenant_1", p_body: "Following up on this." });
  });

  it("rejects an empty message body before calling the database", async () => {
    const rpc = vi.fn();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ supabaseClient: { rpc } });
    const response = await POST(request({ body: "   " }), params());
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a 500 when the RPC itself rejects", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: new Error("Tenant was not found.") }));
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ supabaseClient: { rpc } });
    const response = await POST(request({ body: "Hello" }), params());
    expect(response.status).toBe(500);
  });
});
