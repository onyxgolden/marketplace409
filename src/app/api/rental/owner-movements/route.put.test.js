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
import { GET, PUT } from "./route";

// Controls-sweep follow-up G13 (M-19): PUT /api/rental/owner-movements
// edits an active movement; the audit trail lives in migration
// 20261101020000 (structural contract in ownerMovementEdit.migration.test.js).
function chainFor({ list = { data: [], error: null }, single = { data: null, error: null }, thenReject = null } = {}) {
  const chain = {};
  for (const method of ["select", "eq", "order", "gte", "lte", "insert", "update"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => single);
  chain.then = thenReject
    ? (resolve, reject) => reject(thenReject)
    : (resolve) => resolve(list);
  return chain;
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

function authed(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user-1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
  return client;
}

function putRequest(body) {
  return new Request("https://test/api/rental/owner-movements", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchAllOwnerFinancialEvents.mockResolvedValue([]);
});

describe("PUT /api/rental/owner-movements", () => {
  it("edits an active movement through the RPC and returns the updated row", async () => {
    const updated = row({ amount: 350, memo: "Owner draw — revised" });
    const rpc = vi.fn(async () => ({ data: { movement: updated }, error: null }));
    // No balance precheck needed: contribution-only balance covers any edit
    // here because listMovements returns no other rows and events are empty
    // — so use a contribution row to skip the disbursement precheck.
    const client = {
      from: vi.fn(() => chainFor({ single: { data: row({ kind: "contribution" }), error: null } })),
      rpc,
    };
    authed(client);
    const response = await PUT(putRequest({ id: "m1", amount: 350, movementDate: "2026-09-12", method: "check", memo: "Owner draw — revised" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.movement).toMatchObject({ id: "m1", amount: 350 });
    expect(rpc).toHaveBeenCalledWith("update_owner_movement", expect.objectContaining({
      p_movement_id: "m1",
      p_amount: 350,
      p_movement_date: "2026-09-12",
      p_method: "check",
    }));
  });

  it("409s on a voided movement without calling the RPC", async () => {
    const rpc = vi.fn();
    const client = {
      from: vi.fn(() => chainFor({ single: { data: row({ status: "voided" }), error: null } })),
      rpc,
    };
    authed(client);
    const response = await PUT(putRequest({ id: "m1", amount: 350, movementDate: "2026-09-12", method: "check", memo: "x" }));
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("422s when a disbursement edit exceeds the balance excluding the edited row", async () => {
    // Balance excluding the edited row: one active contribution of $500 →
    // $500 available. A $600 edit overdraws; a $350 edit would pass.
    const contribution = row({ id: "m2", kind: "contribution", amount: 500 });
    const rpc = vi.fn();
    const client = {
      from: vi.fn(() => chainFor({
        list: { data: [row(), contribution], error: null },
        single: { data: row(), error: null },
      })),
      rpc,
    };
    authed(client);
    const response = await PUT(putRequest({ id: "m1", amount: 600, movementDate: "2026-09-12", method: "check", memo: "x" }));
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the precheck when the new amount fits the balance excluding the edited row", async () => {
    // Without exclusion the balance would be $500 − $300 = $200 and a $350
    // edit would 422. With exclusion it is $500, so the RPC runs.
    const contribution = row({ id: "m2", kind: "contribution", amount: 500 });
    const rpc = vi.fn(async () => ({ data: { movement: row({ amount: 350 }) }, error: null }));
    const client = {
      from: vi.fn(() => chainFor({
        list: { data: [row(), contribution], error: null },
        single: { data: row(), error: null },
      })),
      rpc,
    };
    authed(client);
    const response = await PUT(putRequest({ id: "m1", amount: 350, movementDate: "2026-09-12", method: "check", memo: "x" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("400s on an invalid method and maps a missing RPC to 503", async () => {
    const client = {
      from: vi.fn(() => chainFor({ single: { data: row(), error: null } })),
      rpc: vi.fn(),
    };
    authed(client);
    const badMethod = await PUT(putRequest({ id: "m1", amount: 350, movementDate: "2026-09-12", method: "bitcoin", memo: "x" }));
    expect(badMethod.status).toBe(400);

    const missingRpc = vi.fn(async () => ({ data: null, error: { message: "Could not find the function public.update_owner_movement" } }));
    const client2 = {
      from: vi.fn(() => chainFor({ single: { data: row({ kind: "contribution" }), error: null } })),
      rpc: missingRpc,
    };
    authed(client2);
    const response = await PUT(putRequest({ id: "m1", amount: 350, movementDate: "2026-09-12", method: "check", memo: "x" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/has not been applied/);
  });
});

describe("GET /api/rental/owner-movements edit info (G13)", () => {
  it("merges edit counts when the edits table exists", async () => {
    const movementsChain = chainFor({ list: { data: [row()], error: null } });
    const editsChain = chainFor({ list: { data: [{ movement_id: "m1", edited_at: "2026-09-15T10:00:00Z" }], error: null } });
    const client = {
      from: vi.fn((table) => table === "owner_cash_movement_edits" ? editsChain : movementsChain),
    };
    authed(client);
    const response = await GET(new Request("https://test/api/rental/owner-movements"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.movements[0]).toMatchObject({ id: "m1", editCount: 1, lastEditedAt: "2026-09-15T10:00:00Z" });
  });

  it("degrades to no edit info when the edits table is absent (pre-migration)", async () => {
    const movementsChain = chainFor({ list: { data: [row()], error: null } });
    const editsChain = chainFor({ thenReject: new Error('relation "owner_cash_movement_edits" does not exist') });
    const client = {
      from: vi.fn((table) => table === "owner_cash_movement_edits" ? editsChain : movementsChain),
    };
    authed(client);
    const response = await GET(new Request("https://test/api/rental/owner-movements"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.movements[0].editCount).toBeUndefined();
  });
});
