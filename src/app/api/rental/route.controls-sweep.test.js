import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: vi.fn(async () => true),
}));

// Scripted supabase client: the lease lookup and the lease update both hit
// rental_leases; the update() call distinguishes them. The schedules update
// is awaited as a thenable resolving to the ended schedule rows.
function scriptedClient(script) {
  const calls = [];
  function query(table) {
    const q = {
      table,
      _updated: false,
      select() { return q; },
      eq() { return q; },
      update(values) { calls.push({ table, values }); q._updated = true; return q; },
      insert() { return q; },
      delete() { return q; },
      async maybeSingle() {
        if (table === "rental_leases" && !q._updated) return { data: script.leaseLookup ?? null, error: null };
        if (table === "rental_leases" && q._updated) return { data: script.leaseUpdate ?? null, error: null };
        return { data: null, error: null };
      },
      async single() { return { data: null, error: null }; },
      then(resolve) { resolve({ data: script.scheduleUpdate ?? [], error: null }); },
    };
    return q;
  }
  return { calls, client: { from: (table) => query(table), rpc: async () => ({ data: null, error: null }) } };
}

const application = {
  units: { findById: vi.fn(async () => null) },
  findUnitsByProperty: vi.fn(async () => []),
  saveUnit: vi.fn(async (value) => value),
  saveTenant: vi.fn(async (value) => value),
  saveLease: vi.fn(async (value) => value),
  saveSchedule: vi.fn(async (value) => value),
  generateMonthlyCharge: vi.fn(async () => null),
};

const mockedAuth = vi.hoisted(() => ({ current: null }));

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => mockedAuth.current),
}));

import { POST } from "./route.js";

function post(body) {
  return POST(new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) }));
}

function authFor(script) {
  const { calls, client } = scriptedClient(script);
  mockedAuth.current = {
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  };
  return calls;
}

describe("end-lease (controls sweep B1)", () => {
  it("ends an active lease and ends its active schedules, leaving charges alone", async () => {
    const calls = authFor({
      leaseLookup: { id: "lease_1", status: "active" },
      leaseUpdate: { id: "lease_1", status: "ended", end_date: "2026-10-31" },
      scheduleUpdate: [{ id: "schedule_1" }, { id: "schedule_2" }],
    });
    const response = await post({ operation: "end-lease", leaseId: "lease_1", endDate: "2026-10-31", reason: "Move-out" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.lease.status).toBe("ended");
    expect(json.schedulesEnded).toBe(2);
    const leaseUpdate = calls.find((call) => call.table === "rental_leases");
    expect(leaseUpdate.values.status).toBe("ended");
    expect(leaseUpdate.values.end_date).toBe("2026-10-31");
    expect(calls.find((call) => call.table === "rent_schedules").values.status).toBe("ended");
  });

  it("defaults the end date to today when omitted", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const calls = authFor({
      leaseLookup: { id: "lease_1", status: "active" },
      leaseUpdate: { id: "lease_1", status: "ended", end_date: today },
      scheduleUpdate: [],
    });
    const response = await post({ operation: "end-lease", leaseId: "lease_1" });
    expect(response.status).toBe(200);
    expect(calls.find((call) => call.table === "rental_leases").values.end_date).toBe(today);
  });

  it("refuses a draft lease with 409", async () => {
    authFor({ leaseLookup: { id: "lease_1", status: "draft" } });
    const response = await post({ operation: "end-lease", leaseId: "lease_1" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/active lease/);
  });

  it("returns 404 for a missing lease", async () => {
    authFor({ leaseLookup: null });
    const response = await post({ operation: "end-lease", leaseId: "lease_nope" });
    expect(response.status).toBe(404);
  });

  it("rejects a malformed end date with 400", async () => {
    authFor({ leaseLookup: { id: "lease_1", status: "active" } });
    const response = await post({ operation: "end-lease", leaseId: "lease_1", endDate: "10/31/2026" });
    expect(response.status).toBe(400);
  });
});
