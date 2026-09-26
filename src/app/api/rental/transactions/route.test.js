import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { DELETE, PATCH, POST } from "./route";

const validBody = {
  eventDate: "2026-09-26",
  description: "Water heater replacement",
  amount: 450,
  transactionKind: "expense",
  normalizedCategory: "property_repairs",
};

function chainable(result = { data: [], error: null }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };
  return query;
}

function database({ eventLookup = { data: [], error: null }, updateResult = { data: [], error: null }, accountLookup = { data: [], error: null } } = {}) {
  const queries = [];
  const client = {
    from: vi.fn((table) => {
      if (table === "financial_accounts") {
        const q = chainable(accountLookup);
        queries.push({ table, query: q });
        return q;
      }
      const updateChain = chainable(updateResult);
      const q = chainable(eventLookup);
      q.update = vi.fn(() => updateChain);
      queries.push({ table, query: q, updateQuery: updateChain });
      return q;
    }),
  };
  return { client, queries };
}

function patchRequest(body) {
  return new Request("https://test/api/rental/transactions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(eventId) {
  return new Request(`https://test/api/rental/transactions?eventId=${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceRole.mockResolvedValue("owner");
});

describe("PATCH /api/rental/transactions", () => {
  it("updates an owned manual event and keeps the original cleared_at", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", cleared: true, cleared_at: "2026-09-20T10:00:00Z" }], error: null },
      updateResult: { data: [{ id: "evt-1" }], error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody, cleared: true }));
    expect(response.status).toBe(200);
    const found = db.queries.findLast((q) => q.table === "financial_events");
    const updatePayload = found.query.update.mock.calls[0][0];
    const updateQuery = found.updateQuery;
    expect(updatePayload.description).toBe("Water heater replacement");
    expect(updatePayload.cleared_at).toBe("2026-09-20T10:00:00Z");
    expect(updatePayload.updated_by).toBe("user-1");
    expect(updateQuery.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(updateQuery.eq).toHaveBeenCalledWith("id", "evt-1");
  });

  it("404s for an event owned by another workspace", async () => {
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-foreign", ...validBody }));
    expect(response.status).toBe(404);
  });

  it("400s on invalid fields", async () => {
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody, amount: -5 }));
    expect(response.status).toBe(400);
  });

  it("403s for read-only members", async () => {
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody }));
    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/rental/transactions", () => {
  it("soft-deletes an owned manual event — marks, never removes", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", cleared: false, cleared_at: null }], error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await DELETE(deleteRequest("evt-1"));
    expect(response.status).toBe(200);
    const found = db.queries.findLast((q) => q.table === "financial_events");
    const updatePayload = found.query.update.mock.calls[0][0];
    const updateQuery = found.updateQuery;
    expect(updatePayload.is_deleted).toBe(true);
    expect(updatePayload.deleted_at).toBeTruthy();
    expect(updatePayload.status).toBe("deleted");
    expect(updatePayload.updated_by).toBe("user-1");
    expect(updateQuery.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(updateQuery.eq).toHaveBeenCalledWith("id", "evt-1");
  });

  it("404s for a foreign event", async () => {
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await DELETE(deleteRequest("evt-foreign"));
    expect(response.status).toBe(404);
  });

  it("403s for read-only members", async () => {
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await DELETE(deleteRequest("evt-1"));
    expect(response.status).toBe(403);
  });
});

describe("POST /api/rental/transactions (regression)", () => {
  it("still creates with the full field set", async () => {
    const db = database();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await POST(new Request("https://test/api/rental/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }));
    expect(response.status).toBe(200);
  });
});
