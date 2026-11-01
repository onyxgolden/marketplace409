import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shared.js", () => ({
  badRequest: (message) => ({ status: 400, json: async () => ({ error: message }) }),
  readOnlyWriteBlocked: vi.fn().mockResolvedValue(false),
}));

import { readOnlyWriteBlocked } from "./shared.js";
import { saveInspection, deleteInspection } from "./inspections.js";

// Controls-sweep follow-up G23 (O-14): draft edit + delete in any state.
const AUTH = (client) => ({ user: { id: "user_1" }, supabaseClient: client });
const LEASE = { id: "lease_1", unit_id: "unit_1" };
const MEMBERSHIP = { tenant_id: "tenant_1" };
const DRAFT_BODY = {
  inspection: { id: "insp_1", leaseId: "lease_1", unitId: "unit_1", tenantId: "tenant_1",
    inspectionType: "move_in", inspectionDate: "2026-11-01", generalNotes: "note" },
  items: [{ area: "Entry", component: "Overall condition", conditionRating: "good",
    notes: "", damageObserved: false, depositReviewRecommended: false,
    estimatedCostCents: null, evidenceDocumentId: null }],
};

function makeClient({ lease = LEASE, membership = MEMBERSHIP, inspection = null, evidence = [] } = {}) {
  const calls = [];
  const chain = (table) => {
    const c = {
      select() { return c; },
      eq() { return c; },
      in() { return c; },
      update(payload) { calls.push({ table, op: "update", payload }); return c; },
      delete() { calls.push({ table, op: "delete" }); return c; },
      insert(payload) { calls.push({ table, op: "insert", payload }); return c; },
      async maybeSingle() {
        if (table === "rental_leases") return { data: lease, error: null };
        if (table === "rental_lease_tenants") return { data: membership, error: null };
        if (table === "rental_inspections") return { data: inspection, error: null };
        return { data: null, error: null };
      },
      then(resolve) {
        if (table === "rental_documents") resolve({ data: evidence, error: null });
        else resolve({ data: null, error: null });
      },
    };
    return c;
  };
  return {
    calls,
    from: (table) => chain(table),
    rpc: async (name, params) => {
      calls.push({ rpc: name, params });
      return { data: { id: "new_1", status: "draft" }, error: null };
    },
  };
}

describe("G23 inspection edit/delete", () => {
  beforeEach(() => { vi.clearAllMocks(); readOnlyWriteBlocked.mockResolvedValue(false); });

  it("O-14: edit updates the draft header and replaces items, same id, no RPC", async () => {
    const client = makeClient({ inspection: { id: "insp_1", status: "draft" } });
    const res = await saveInspection({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: DRAFT_BODY });
    expect(res.status).toBe(200);
    expect((await res.json()).inspection).toMatchObject({ id: "insp_1", status: "draft" });
    expect(client.calls.some((c) => c.rpc)).toBe(false);
    const header = client.calls.find((c) => c.table === "rental_inspections" && c.op === "update");
    expect(header.payload).toMatchObject({ lease_id: "lease_1", inspection_type: "move_in", inspection_date: "2026-11-01" });
    expect(client.calls.some((c) => c.table === "rental_inspection_items" && c.op === "delete")).toBe(true);
    const insert = client.calls.find((c) => c.table === "rental_inspection_items" && c.op === "insert");
    expect(insert.payload[0]).toMatchObject({ inspection_id: "insp_1", area: "Entry", condition_rating: "good" });
  });

  it("O-14: edit 409s on a finalized inspection and 404s when missing", async () => {
    const finalized = makeClient({ inspection: { id: "insp_1", status: "finalized" } });
    const res = await saveInspection({ authenticated: AUTH(finalized), effectiveOwnerId: "owner_1", body: DRAFT_BODY });
    expect(res.status).toBe(409);
    expect(finalized.calls.some((c) => c.op === "update")).toBe(false);
    const missing = makeClient({ inspection: null });
    const res2 = await saveInspection({ authenticated: AUTH(missing), effectiveOwnerId: "owner_1", body: DRAFT_BODY });
    expect(res2.status).toBe(404);
  });

  it("O-14: create without an id still goes through the RPC", async () => {
    const client = makeClient({});
    const { inspection: { id, ...rest }, ...bodyRest } = DRAFT_BODY;
    const res = await saveInspection({ authenticated: AUTH(client), effectiveOwnerId: "owner_1",
      body: { ...bodyRest, inspection: rest } });
    expect(res.status).toBe(200);
    expect(client.calls.some((c) => c.rpc === "save_rental_inspection")).toBe(true);
  });

  it("O-14: delete clears acknowledgements first, then the inspection (items cascade)", async () => {
    const client = makeClient({ inspection: { id: "insp_1" } });
    const res = await deleteInspection({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { inspectionId: "insp_1" } });
    expect(res.status).toBe(200);
    const ackIdx = client.calls.findIndex((c) => c.table === "rental_inspection_acknowledgements" && c.op === "delete");
    const inspIdx = client.calls.findIndex((c) => c.table === "rental_inspections" && c.op === "delete");
    expect(ackIdx).toBeGreaterThan(-1);
    expect(inspIdx).toBeGreaterThan(ackIdx);
  });

  it("O-14: delete 404s when missing and 403s for read-only members", async () => {
    const missing = makeClient({ inspection: null });
    const res = await deleteInspection({ authenticated: AUTH(missing), effectiveOwnerId: "owner_1", body: { inspectionId: "insp_1" } });
    expect(res.status).toBe(404);
    readOnlyWriteBlocked.mockResolvedValue(true);
    const client = makeClient({ inspection: { id: "insp_1" } });
    const res2 = await deleteInspection({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { inspectionId: "insp_1" } });
    expect(res2.status).toBe(403);
    const res3 = await saveInspection({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: DRAFT_BODY });
    expect(res3.status).toBe(403);
  });
});
