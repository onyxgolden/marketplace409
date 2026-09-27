import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

function chainable(result = { data: [], error: null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
    limit: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
}

function database({ eventLookup = { data: [], error: null }, splitsLookup = { data: [], error: null } } = {}) {
  const calls = [];
  const insertChain = chainable({ data: [{ id: "split-1" }], error: null });
  const client = {
    from: vi.fn((table) => {
      if (table === "financial_events") {
        const q = chainable(eventLookup);
        calls.push({ table, query: q });
        return q;
      }
      const q = chainable(splitsLookup);
      q.delete = vi.fn(() => chainable({ data: null, error: null }));
      q.insert = vi.fn(() => insertChain);
      calls.push({ table, query: q });
      return q;
    }),
  };
  return { client, calls, insertChain };
}

function postRequest(body) {
  return new Request("https://test/api/rental/transaction-splits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceRole.mockResolvedValue("owner");
});

const ownedEvent = { data: [{ id: "evt-1", amount: 450 }], error: null };

describe("POST /api/rental/transaction-splits", () => {
  it("replaces split lines when the total matches the transaction exactly", async () => {
    const db = database({ eventLookup: ownedEvent });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await POST(postRequest({
      eventId: "evt-1",
      splits: [
        { normalizedCategory: "property_repairs", amount: 300 },
        { normalizedCategory: "supplies", amount: 150, memo: "Filters" },
      ],
    }));
    expect(response.status).toBe(200);
    const insertCall = db.calls.find((call) => call.table === "financial_event_splits" && call.query.insert.mock.calls.length > 0);
    const inserted = insertCall.query.insert.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      owner_id: "owner_1",
      parent_event_id: "evt-1",
      normalized_category: "property_repairs",
      amount: 300,
    });
    expect(inserted[1].memo).toBe("Filters");
  });

  it("400s when the split total does not match the transaction total", async () => {
    const db = database({ eventLookup: ownedEvent });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await POST(postRequest({
      eventId: "evt-1",
      splits: [{ normalizedCategory: "property_repairs", amount: 449.99 }],
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/off by \$-0\.01/);
  });

  it("404s for a foreign event and never touches splits", async () => {
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await POST(postRequest({
      eventId: "evt-foreign",
      splits: [{ normalizedCategory: "property_repairs", amount: 450 }],
    }));
    expect(response.status).toBe(404);
    expect(db.calls.some((call) => call.table === "financial_event_splits")).toBe(false);
  });

  it("403s for read-only members", async () => {
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const db = database({ eventLookup: ownedEvent });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await POST(postRequest({
      eventId: "evt-1",
      splits: [{ normalizedCategory: "property_repairs", amount: 450 }],
    }));
    expect(response.status).toBe(403);
  });
});

describe("GET /api/rental/transaction-splits", () => {
  it("lists splits scoped to the owned event", async () => {
    const db = database({
      eventLookup: ownedEvent,
      splitsLookup: { data: [{ id: "split-1", normalized_category: "supplies", amount: 150, memo: null }], error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await GET(new Request("https://test/api/rental/transaction-splits?eventId=evt-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.splits).toHaveLength(1);
    expect(body.splits[0]).toMatchObject({ normalized_category: "supplies", amount: 150 });
    const splitsCall = db.calls.find((call) => call.table === "financial_event_splits");
    expect(splitsCall.query.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(splitsCall.query.eq).toHaveBeenCalledWith("parent_event_id", "evt-1");
  });

  it("404s for a foreign event", async () => {
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await GET(new Request("https://test/api/rental/transaction-splits?eventId=evt-foreign"));
    expect(response.status).toBe(404);
  });
});
