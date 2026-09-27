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

function database({ eventLookup = { data: [], error: null }, updateResult = { data: [], error: null }, accountLookup = { data: [], error: null }, rpcResult = { data: { id: "evt-1" }, error: null } } = {}) {
  const queries = [];
  const rpcCalls = [];
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
    // The PATCH writes its edit through one RPC in a single database
    // transaction — one call, one failure surface. There is no separate
    // history insert to swallow.
    rpc: vi.fn((name, args) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
    }),
  };
  return { client, queries, rpcCalls };
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
  it("updates an owned manual event through one RPC and keeps the original cleared_at", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", cleared: true, cleared_at: "2026-09-20T10:00:00Z" }], error: null },
      rpcResult: { data: { id: "evt-1", cleared: true, cleared_at: "2026-09-20T10:00:00Z" }, error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody, cleared: true }));
    expect(response.status).toBe(200);
    expect(db.rpcCalls).toHaveLength(1);
    const { name, args } = db.rpcCalls[0];
    expect(name).toBe("update_transaction_with_history");
    expect(args.p_owner_id).toBe("owner_1");
    expect(args.p_event_id).toBe("evt-1");
    expect(args.p_event.description).toBe("Water heater replacement");
    expect(args.p_cleared_at).toBe("2026-09-20T10:00:00Z");
    expect(args.p_edited_by).toBe("user-1");
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.event.id).toBe("evt-1");
  });

  it("passes the new ledger fields and the edit-history diff to the RPC", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", cleared: false, cleared_at: null, description: "Old description" }], error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({
      eventId: "evt-1",
      ...validBody,
      displayAs: "Water heater — 308 Paula",
      refNumber: "INV-123",
      payeeMailingAddress: "PO Box 1",
      assignedTo: "Acme Plumbing",
      paymentMethod: "check",
      isRecurring: true,
      recurrenceRule: "monthly",
      depreciate: true,
    }));
    expect(response.status).toBe(200);
    expect(db.rpcCalls).toHaveLength(1);
    const { args } = db.rpcCalls[0];
    expect(args.p_event.displayAs).toBe("Water heater — 308 Paula");
    expect(args.p_event.refNumber).toBe("INV-123");
    expect(args.p_event.payeeMailingAddress).toBe("PO Box 1");
    expect(args.p_event.assignedTo).toBe("Acme Plumbing");
    expect(args.p_event.isRecurring).toBe(true);
    expect(args.p_event.recurrenceRule).toBe("monthly");
    expect(args.p_event.depreciate).toBe(true);
    expect(args.p_event.paymentMethod).toBe("check");
    expect(args.p_changes.displayAs).toEqual({ from: null, to: "Water heater — 308 Paula" });
    expect(args.p_changes.description).toEqual({ from: "Old description", to: "Water heater replacement" });
  });

  it("fails the whole edit loudly when the RPC fails — a history-write failure is never swallowed", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", description: "Old description" }], error: null },
      rpcResult: { data: null, error: new Error("insert into financial_event_edits failed") },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody, description: "New description" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).not.toBe(true);
    expect(body.error).toBe("Unable to save the transaction.");
    // The RPC is the single unit of work: exactly one call, and its failure
    // means the edit did not succeed — the database rolls the edit back
    // together with the failed history insert.
    expect(db.rpcCalls).toHaveLength(1);
  });

  it("does not record a change when the database returns the amount as a string", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", cleared: false, cleared_at: null, description: "Water heater replacement", amount: "450.00", event_date: "2026-09-26", transaction_kind: "expense", normalized_category: "property_repairs" }], error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody }));
    expect(response.status).toBe(200);
    // Nothing changed, so the RPC receives an empty diff and writes no
    // history row at all.
    expect(db.rpcCalls[0].args.p_changes).toEqual({});
  });

  it("records turning a recurring schedule off as a change (text column, lossless comparison)", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", is_recurring: true, recurrence_rule: "monthly" }], error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody }));
    expect(response.status).toBe(200);
    const changes = db.rpcCalls[0].args.p_changes;
    expect(changes.recurrenceRule).toEqual({ from: "monthly", to: null });
    expect(changes.isRecurring).toEqual({ from: true, to: false });
  });

  it("does not record a recurrence change when the rule is unchanged", async () => {
    const db = database({
      eventLookup: { data: [{ id: "evt-1", is_recurring: true, recurrence_rule: "monthly" }], error: null },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" }, effectiveOwnerId: "owner_1", supabaseClient: db.client,
    });
    const response = await PATCH(patchRequest({ eventId: "evt-1", ...validBody, isRecurring: true, recurrenceRule: "monthly" }));
    expect(response.status).toBe(200);
    const changes = db.rpcCalls[0].args.p_changes;
    expect(changes.recurrenceRule).toBeUndefined();
    expect(changes.isRecurring).toBeUndefined();
  });

  it("404s for an event owned by another workspace", async () => {    const db = database();
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
