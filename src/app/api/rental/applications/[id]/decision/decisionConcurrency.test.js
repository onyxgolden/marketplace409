import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST as decide } from "./route";

// Decision concurrency (R21 CHANGES fix): the route performs the decision
// through ONE decide_rental_application RPC call. The RPC locks the
// application row (FOR UPDATE) and re-validates status = 'pending' under the
// lock, so concurrent deciders serialize in the database: exactly one wins
// and the loser gets P0001, which the route maps to HTTP 409. These tests
// prove the route issues exactly one RPC per decision, never falls back to
// separate table writes under concurrency, and maps the loser's P0001 to 409.

const APP_ROW = {
  id: "app_1", listing_id: "listing_1", status: "pending",
  answers: { personal: { firstName: "Sam", lastName: "Applicant", email: "sam@example.com" }, consent: true },
};

function makeDb({ rpcImpl } = {}) {
  const rpcCalls = [];
  const calls = { rpc: rpcCalls, insert: [], update: [] };
  const db = {
    rpc: vi.fn(async (name, args) => {
      rpcCalls.push({ name, args });
      return rpcImpl(name, args);
    }),
    from: vi.fn((name) => {
      const table = {
        select() { return table; },
        eq() { return table; },
        async maybeSingle() {
          if (name === "rental_applications") return { data: APP_ROW, error: null };
          if (name === "rental_listings") return { data: { id: "listing_1", rent_cents: 160000 }, error: null };
          return { data: null, error: null };
        },
        insert(payload) { calls.insert.push({ table: name, payload }); return table; },
        update(payload) { calls.update.push({ table: name, payload }); return table; },
      };
      return table;
    }),
  };
  return { db, calls };
}

function auth(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    supabaseClient: db, user: { id: "user_1" }, effectiveOwnerId: "owner_1",
  });
  getActiveWorkspaceRole.mockResolvedValue("owner");
}

const postDecision = (body) => decide(
  new Request("https://t/", { method: "POST", body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: "app_1" }) },
);

describe("decision concurrency", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("issues exactly one RPC call per decision — no separate table writes", async () => {
    const { db, calls } = makeDb({
      rpcImpl: async () => ({ data: { decision_id: "dec_1", action: "approved", tenant_id: "t", lease_id: "l" }, error: null }),
    });
    auth(db);
    const response = await postDecision({ action: "approve", lease: { startDate: "2026-11-01" } });
    expect(response.status).toBe(200);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("decide_rental_application");
    expect(calls.insert).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it("serializes concurrent decisions: one winner, the loser gets 409", async () => {
    // Simulate the database serialization: the first RPC wins, the second
    // sees the row already decided (P0001 from the FOR UPDATE re-check).
    let calls = 0;
    const { db } = makeDb({
      rpcImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return { data: { decision_id: "dec_1", action: "denied", tenant_id: null, lease_id: null }, error: null };
        }
        return { data: null, error: Object.assign(new Error("Only a pending application can be decided."), { code: "P0001" }) };
      },
    });
    auth(db);
    const [first, second] = await Promise.all([
      postDecision({ action: "deny", reason: "first" }),
      postDecision({ action: "deny", reason: "second" }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    const loserBody = await second.json();
    expect(loserBody.error).toMatch(/pending/);
  });

  it("never issues a second RPC or table writes after a P0001 loss", async () => {
    const { db, calls } = makeDb({
      rpcImpl: async () => ({
        data: null,
        error: Object.assign(new Error("Only a pending application can be decided."), { code: "P0001" }),
      }),
    });
    auth(db);
    const response = await postDecision({ action: "approve", lease: { startDate: "2026-11-01" } });
    expect(response.status).toBe(409);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.insert).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it("a concurrent approve/deny pair still resolves to exactly one outcome", async () => {
    let decided = false;
    const { db } = makeDb({
      rpcImpl: async (name, args) => {
        if (decided) {
          return { data: null, error: Object.assign(new Error("Only a pending application can be decided."), { code: "P0001" }) };
        }
        decided = true;
        return {
          data: {
            decision_id: "dec_1",
            action: args.p_action === "approve" ? "approved" : "denied",
            tenant_id: args.p_action === "approve" ? "t" : null,
            lease_id: args.p_action === "approve" ? "l" : null,
          },
          error: null,
        };
      },
    });
    auth(db);
    const [approveRes, denyRes] = await Promise.all([
      postDecision({ action: "approve", lease: { startDate: "2026-11-01" } }),
      postDecision({ action: "deny", reason: "changed mind" }),
    ]);
    const statuses = [approveRes.status, denyRes.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
