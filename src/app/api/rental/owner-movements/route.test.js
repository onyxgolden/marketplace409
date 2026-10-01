import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(),
}));
vi.mock("@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents", () => ({
  fetchAllOwnerFinancialEvents: vi.fn(),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { GET, POST, PATCH } from "./route";

// A supabase chain where every builder returns itself; awaiting resolves to
// `list`, and .single() resolves to `single`. Covers the query shapes the
// movements routes use: select/eq/order/order, select/eq/eq/single,
// insert/select/single, update/eq/eq/eq/select/single.
function chainFor({ list = { data: [], error: null }, single = { data: null, error: null } } = {}) {
  const chain = {};
  for (const method of ["select", "eq", "order", "gte", "lte", "insert", "update"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => single);
  chain.then = (resolve) => resolve(list);
  return chain;
}

function authed(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user-1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
  return client;
}

const row = (overrides = {}) => ({
  id: "m1",
  property_id: null,
  kind: "disbursement",
  amount: 300,
  movement_date: "2026-09-12",
  method: "check",
  memo: "Owner draw",
  status: "active",
  voided_at: null,
  created_by: "user-1",
  created_at: "2026-09-12T10:00:00Z",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchAllOwnerFinancialEvents.mockResolvedValue([]);
});

describe("GET /api/rental/owner-movements", () => {
  it("returns movements and the current owner balance", async () => {
    const client = { from: vi.fn(() => chainFor({ list: { data: [row()], error: null } })) };
    authed(client);
    const response = await GET(new Request("https://test/api/rental/owner-movements"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.movements).toHaveLength(1);
    expect(body.movements[0]).toMatchObject({ id: "m1", kind: "disbursement", amount: 300 });
    expect(body.balance).toMatchObject({ disbursementCents: 30000, balanceCents: -30000 });
  });

  it("rejects an invalid kind filter", async () => {
    authed({ from: vi.fn(() => chainFor()) });
    const response = await GET(new Request("https://test/api/rental/owner-movements?kind=bogus"));
    expect(response.status).toBe(400);
  });

  it("the balance reflects voided-free active movements even when the list is filtered", async () => {
    // List query (filtered) returns nothing; the balance query (active) finds one.
    const client = {
      from: vi.fn((table) => {
        expect(table).toBe("owner_cash_movements");
        return chainFor({ list: { data: [], error: null } });
      }),
    };
    authed(client);
    const response = await GET(new Request("https://test/api/rental/owner-movements?status=voided"));
    const body = await response.json();
    expect(body.movements).toHaveLength(0);
    expect(body.balance).toBeDefined();
  });
});

describe("POST /api/rental/owner-movements", () => {
  const post = (payload, client) =>
    POST(new Request("https://test/api/rental/owner-movements", { method: "POST", body: JSON.stringify(payload) }));

  it("403s for read-only members", async () => {
    const client = { from: vi.fn(() => chainFor()) };
    authed(client, "read_only");
    const response = await post({ kind: "disbursement", amount: 100, movementDate: "2026-09-12" }, client);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/read-only/i);
  });

  it("records a contribution (no balance check)", async () => {
    const client = { from: vi.fn(() => chainFor({ single: { data: row({ kind: "contribution", amount: 1000 }), error: null } })) };
    authed(client);
    const response = await post({ kind: "contribution", amount: 1000, movementDate: "2026-09-15", memo: "Covering repairs" }, client);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.movement).toMatchObject({ kind: "contribution", amount: 1000 });
  });

  it("records a disbursement within the available balance", async () => {
    fetchAllOwnerFinancialEvents.mockResolvedValue([
      { id: "e1", event_date: "2026-09-05", amount: 1600, transaction_kind: "income", property_id: null, status: "active", is_deleted: false },
    ]);
    const client = { from: vi.fn(() => chainFor({ single: { data: row(), error: null } })) };
    authed(client);
    const response = await post({ kind: "disbursement", amount: 300, movementDate: "2026-09-12", method: "ach" }, client);
    expect(response.status).toBe(201);
  });

  it("422s when the disbursement exceeds the available balance", async () => {
    fetchAllOwnerFinancialEvents.mockResolvedValue([]);
    const client = { from: vi.fn(() => chainFor()) };
    authed(client);
    const response = await post({ kind: "disbursement", amount: 500, movementDate: "2026-09-12" }, client);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toMatch(/exceeds the amount due/i);
    expect(body.balanceCents).toBe(0);
  });

  it("a voided disbursement frees the balance for a new one", async () => {
    fetchAllOwnerFinancialEvents.mockResolvedValue([
      { id: "e1", event_date: "2026-09-05", amount: 1600, transaction_kind: "income", property_id: null, status: "active", is_deleted: false },
    ]);
    const client = {
      from: vi.fn(() =>
        chainFor({
          list: { data: [row({ status: "voided", amount: 1600 })], error: null },
          single: { data: row({ amount: 1600 }), error: null },
        }),
      ),
    };
    authed(client);
    const response = await post({ kind: "disbursement", amount: 1600, movementDate: "2026-09-20" }, client);
    expect(response.status).toBe(201);
  });

  it("rejects bad input before any balance work", async () => {
    const client = { from: vi.fn(() => chainFor()) };
    authed(client);
    for (const payload of [
      { kind: "gift", amount: 100, movementDate: "2026-09-12" },
      { kind: "disbursement", amount: 0, movementDate: "2026-09-12" },
      { kind: "disbursement", amount: 100, movementDate: "not-a-date" },
    ]) {
      expect((await post(payload, client)).status).toBe(400);
    }
  });
});

describe("PATCH /api/rental/owner-movements", () => {
  const patch = (payload, client) =>
    PATCH(new Request("https://test/api/rental/owner-movements", { method: "PATCH", body: JSON.stringify(payload) }));

  it("403s for read-only members", async () => {
    const client = { from: vi.fn(() => chainFor()) };
    authed(client, "read_only");
    const response = await patch({ id: "m1" }, client);
    expect(response.status).toBe(403);
  });

  it("voids an active movement (restoring the balance)", async () => {
    const client = {
      from: vi.fn(() =>
        chainFor({
          single: { data: row({ status: "active" }), error: null },
          list: { data: [], error: null },
        }),
      ),
    };
    // First single() call is the lookup (active); the update's single() returns voided.
    const lookupChain = chainFor({ single: { data: row({ status: "active" }), error: null } });
    const updateChain = chainFor({ single: { data: row({ status: "voided", voided_at: "2026-10-01T00:00:00Z" }), error: null } });
    let calls = 0;
    client.from = vi.fn(() => (calls++ === 0 ? lookupChain : updateChain));
    authed(client);
    const response = await patch({ id: "m1" }, client);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.movement.status).toBe("voided");
    expect(updateChain.update).toHaveBeenCalled();
    const updateArgs = updateChain.update.mock.calls[0][0];
    expect(updateArgs.status).toBe("voided");
    expect(updateArgs.voided_by).toBe("user-1");
  });

  it("404s for an unknown id and 409s for an already-voided movement", async () => {
    const missing = { from: vi.fn(() => chainFor({ single: { data: null, error: new Error("none") } })) };
    authed(missing);
    expect((await patch({ id: "nope" }, missing)).status).toBe(404);

    const voided = { from: vi.fn(() => chainFor({ single: { data: row({ status: "voided" }), error: null } })) };
    authed(voided);
    const response = await patch({ id: "m1" }, voided);
    expect(response.status).toBe(409);
  });
});
