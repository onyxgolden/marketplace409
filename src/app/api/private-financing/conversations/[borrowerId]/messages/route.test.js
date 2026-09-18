import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

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
  return new Request("http://localhost/api/private-financing/conversations/brw_1/messages", { method: "POST", body: JSON.stringify(body) });
}
function params() { return { params: Promise.resolve({ borrowerId: "brw_1" }) }; }

describe("owner private-financing conversation thread route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the full message thread for the borrower's conversation, oldest first, and marks it read", async () => {
    const conversationTable = chain({ data: { id: "pf_conversation_1" }, error: null });
    const messagesTable = chain({ data: [
      { id: "m1", sender_type: "borrower", body: "You should offer autopay for extra principal.", category: "suggestion", created_at: "2026-09-18T11:00:00Z" },
      { id: "m2", sender_type: "owner", body: "Good idea, looking into it.", category: null, created_at: "2026-09-18T12:00:00Z" },
    ], error: null });
    const tables = { private_financing_conversations: conversationTable, private_financing_conversation_messages: messagesTable };
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    mocks.authenticate.mockResolvedValue({ supabaseClient: { from: (table) => tables[table], rpc } });
    const response = await GET(new Request("http://localhost"), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.messages).toEqual([
      { id: "m1", senderType: "borrower", body: "You should offer autopay for extra principal.", category: "suggestion", createdAt: "2026-09-18T11:00:00Z" },
      { id: "m2", senderType: "owner", body: "Good idea, looking into it.", category: null, createdAt: "2026-09-18T12:00:00Z" },
    ]);
    expect(rpc).toHaveBeenCalledWith("mark_pf_conversation_read_by_owner", { p_borrower_id: "brw_1" });
  });

  it("returns an empty thread (and never marks a non-existent conversation read) when the borrower has never messaged", async () => {
    const conversationTable = chain({ data: null, error: null });
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    mocks.authenticate.mockResolvedValue({ supabaseClient: { from: () => conversationTable, rpc } });
    const response = await GET(new Request("http://localhost"), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.messages).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends an owner message through the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { conversationId: "pf_conversation_1", messageId: "m3" }, error: null }));
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });
    const response = await POST(request({ body: "Following up on this." }), params());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("send_pf_conversation_owner_message", { p_borrower_id: "brw_1", p_body: "Following up on this." });
  });

  it("rejects an empty message body before calling the database", async () => {
    const rpc = vi.fn();
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });
    const response = await POST(request({ body: "   " }), params());
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a 500 when the RPC itself rejects", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: new Error("Borrower was not found.") }));
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });
    const response = await POST(request({ body: "Hello" }), params());
    expect(response.status).toBe(500);
  });
});
