import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET } from "./route";

function chainable(result = { data: [], error: null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
    limit: vi.fn().mockResolvedValue(result),
  };
}

function database({ eventLookup = { data: [], error: null }, editsLookup = { data: [], error: null } } = {}) {
  const calls = [];
  const client = {
    from: vi.fn((table) => {
      const q = chainable(table === "financial_events" ? eventLookup : editsLookup);
      calls.push({ table, query: q });
      return q;
    }),
  };
  return { client, calls };
}

function getRequest(eventId) {
  return new Request(`https://test/api/rental/transaction-edits${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`);
}

function authenticated(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    supabaseClient: db.client,
    user: { id: "user-1" },
    effectiveOwnerId: "owner_1",
    response: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const ownedEvent = { data: [{ id: "evt-1" }], error: null };

describe("GET /api/rental/transaction-edits", () => {
  it("returns the edit history newest-first for an owned manual event", async () => {
    const edits = [
      { id: "edit-2", edited_at: "2026-09-27T10:00:00Z", edited_by: "user-1", changes: { memo: { from: null, to: "note" } } },
      { id: "edit-1", edited_at: "2026-09-26T10:00:00Z", edited_by: "user-1", changes: { amount: { from: 100, to: 120 } } },
    ];
    const db = database({ eventLookup: ownedEvent, editsLookup: { data: edits, error: null } });
    authenticated(db);

    const response = await GET(getRequest("evt-1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.edits).toHaveLength(2);
    expect(body.edits[0].id).toBe("edit-2");
    const editsQuery = db.calls.find((call) => call.table === "financial_event_edits").query;
    expect(editsQuery.order).toHaveBeenCalledWith("edited_at", { ascending: false });
    expect(editsQuery.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(editsQuery.eq).toHaveBeenCalledWith("event_id", "evt-1");
  });

  it("404s when the event is not an owned manual event", async () => {
    const db = database({ eventLookup: { data: [], error: null } });
    authenticated(db);

    const response = await GET(getRequest("evt-missing"));
    expect(response.status).toBe(404);
    expect(db.calls.some((call) => call.table === "financial_event_edits")).toBe(false);
  });

  it("400s when eventId is missing", async () => {
    const db = database();
    authenticated(db);

    const response = await GET(getRequest(null));
    expect(response.status).toBe(400);
  });
});
