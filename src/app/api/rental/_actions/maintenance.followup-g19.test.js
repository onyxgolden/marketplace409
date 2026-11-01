import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  createMaintenanceRequest, updateContractor, deactivateContractor, reactivateContractor,
} from "./maintenance.js";

// Controls-sweep follow-up G19 (O-05, O-06): landlord create-request and
// contractor edit/deactivate. The mock supabase chain implements the
// select/eq/update/insert/maybeSingle/single/then surface these ops use.
function makeClient({ lease = null, members = [], contractors = [] } = {}) {
  const inserts = [];
  const updates = [];
  function chain(table) {
    const filters = [];
    const c = {
      select: () => c,
      eq: (column, value) => { filters.push([column, value]); return c; },
      update: (row) => { c.updated = row; return c; },
      insert: (row) => { c.inserted = row; inserts.push({ table, row }); return c; },
      maybeSingle: async () => {
        if (table === "rental_leases") {
          const hit = lease && filters.every(([col, val]) => lease[col] === val) ? lease : null;
          return { data: hit, error: null };
        }
        if (table === "rental_contractors" && c.updated) {
          const hit = contractors.find((row) => filters.every(([col, val]) => row[col] === val));
          if (!hit) return { data: null, error: null };
          Object.assign(hit, c.updated);
          updates.push({ table, row: { ...c.updated } });
          return { data: { id: hit.id, status: hit.status }, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (c.inserted) return { data: { ...c.inserted }, error: null };
        return { data: null, error: null };
      },
      then: (resolve) => {
        if (table === "rental_lease_tenants") {
          resolve({ data: members.filter((row) => filters.every(([col, val]) => row[col] === val)), error: null });
        } else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { inserts, updates, from: (table) => chain(table), rpc: async () => ({ data: null, error: null }) };
}

const AUTH = { user: { id: "owner_1" }, supabaseClient: null };

describe("maintenance follow-up G19 actions", () => {
  it("O-05: landlord-created request files against the lease household's primary tenant", async () => {
    const client = makeClient({
      lease: { id: "lease_1", unit_id: "unit_1", status: "active", owner_id: "owner_1" },
      members: [
        { tenant_id: "tenant_co", occupancy_role: "co_tenant", owner_id: "owner_1", lease_id: "lease_1" },
        { tenant_id: "tenant_primary", occupancy_role: "primary", owner_id: "owner_1", lease_id: "lease_1" },
      ],
    });
    AUTH.supabaseClient = client;
    const response = await createMaintenanceRequest({ authenticated: AUTH, effectiveOwnerId: "owner_1",
      body: { request: { leaseId: "lease_1", title: "Leak", description: "Under sink", priority: "urgent",
        permissionToEnter: true, contactPhone: "555-1" } } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.request.tenant_id).toBe("tenant_primary");
    expect(body.request.status).toBe("submitted");
    expect(body.request.unit_id).toBe("unit_1");
  });

  it("O-05: non-active lease 409s and unknown lease 404s", async () => {
    const ended = makeClient({ lease: { id: "lease_2", unit_id: "u", status: "ended", owner_id: "owner_1" } });
    AUTH.supabaseClient = ended;
    const endedResponse = await createMaintenanceRequest({ authenticated: AUTH, effectiveOwnerId: "owner_1",
      body: { request: { leaseId: "lease_2", title: "T", description: "D" } } });
    expect(endedResponse.status).toBe(409);
    const missing = makeClient({});
    AUTH.supabaseClient = missing;
    const missingResponse = await createMaintenanceRequest({ authenticated: AUTH, effectiveOwnerId: "owner_1",
      body: { request: { leaseId: "nope", title: "T", description: "D" } } });
    expect(missingResponse.status).toBe(404);
  });

  it("O-06: contractor edit updates fields and unknown id 404s", async () => {
    const contractors = [{ id: "c1", owner_id: "owner_1", business_name: "Old", phone: "111", status: "active" }];
    const client = makeClient({ contractors });
    AUTH.supabaseClient = client;
    const response = await updateContractor({ authenticated: AUTH, effectiveOwnerId: "owner_1",
      body: { contractor: { id: "c1", businessName: "New Name", phone: "222" } } });
    expect(response.status).toBe(200);
    expect(contractors[0].business_name).toBe("New Name");
    expect(contractors[0].phone).toBe("222");
    const gone = await updateContractor({ authenticated: AUTH, effectiveOwnerId: "owner_1",
      body: { contractor: { id: "cX", businessName: "X" } } });
    expect(gone.status).toBe(404);
  });

  it("O-06: deactivate sets inactive and reactivate restores active", async () => {
    const contractors = [{ id: "c1", owner_id: "owner_1", status: "active" }];
    const client = makeClient({ contractors });
    AUTH.supabaseClient = client;
    const off = await deactivateContractor({ authenticated: AUTH, effectiveOwnerId: "owner_1", body: { contractorId: "c1" } });
    expect(off.status).toBe(200);
    expect(contractors[0].status).toBe("inactive");
    const on = await reactivateContractor({ authenticated: AUTH, effectiveOwnerId: "owner_1", body: { contractorId: "c1" } });
    expect(on.status).toBe(200);
    expect(contractors[0].status).toBe("active");
  });
});
