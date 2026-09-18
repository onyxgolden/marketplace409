import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

import { GET } from "./route";

function chain(data, error = null) {
  const query = { select: () => query, eq: () => query, in: () => query, order: () => Promise.resolve({ data, error }),
    then: (resolve) => resolve({ data, error }) };
  return query;
}

function buildClient({ conversations, borrowers = [{ id: "brw_1", full_name: "Jordan Ellis", email: "jordan@example.com" }] } = {}) {
  return {
    from: vi.fn((table) => {
      if (table === "private_financing_conversations") return chain(conversations);
      if (table === "private_financing_borrowers") return chain(borrowers);
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("GET /api/private-financing/conversations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists conversations with a real joined borrower name and unread computed from the borrower's own last message", async () => {
    mocks.authenticate.mockResolvedValue({ supabaseClient: buildClient({
      conversations: [
        { id: "pf_conversation_1", borrower_id: "brw_1", last_message_at: "2026-09-18T12:00:00Z", last_message_body: "You should offer autopay.", last_message_sender_type: "borrower", owner_last_read_at: null },
      ],
    }) });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.conversations).toEqual([{
      id: "pf_conversation_1", borrowerId: "brw_1", borrowerName: "Jordan Ellis",
      lastMessageAt: "2026-09-18T12:00:00Z", lastMessageBody: "You should offer autopay.", lastMessageSenderType: "borrower", unread: true,
    }]);
  });

  it("is not unread when the owner sent the most recent message", async () => {
    mocks.authenticate.mockResolvedValue({ supabaseClient: buildClient({
      conversations: [
        { id: "pf_conversation_1", borrower_id: "brw_1", last_message_at: "2026-09-18T12:00:00Z", last_message_body: "Looking into it.", last_message_sender_type: "owner", owner_last_read_at: "2026-09-18T12:00:00Z" },
      ],
    }) });
    const response = await GET();
    const body = await response.json();
    expect(body.conversations[0].unread).toBe(false);
  });

  it("falls back to the borrower id when no borrower record joins (defensive, should not normally happen)", async () => {
    mocks.authenticate.mockResolvedValue({ supabaseClient: buildClient({
      conversations: [
        { id: "pf_conversation_1", borrower_id: "brw_missing", last_message_at: "2026-09-18T12:00:00Z", last_message_body: "Hi", last_message_sender_type: "borrower", owner_last_read_at: null },
      ],
      borrowers: [],
    }) });
    const response = await GET();
    const body = await response.json();
    expect(body.conversations[0].borrowerName).toBe("brw_missing");
  });

  it("returns an empty list without querying borrowers when there are no conversations", async () => {
    const client = buildClient({ conversations: [] });
    mocks.authenticate.mockResolvedValue({ supabaseClient: client });
    const response = await GET();
    const body = await response.json();
    expect(body.conversations).toEqual([]);
    expect(client.from).not.toHaveBeenCalledWith("private_financing_borrowers");
  });
});
