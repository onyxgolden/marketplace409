import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
// The lease domain imports the supabase client module, which creates a
// browser client eagerly at import time; route tests mock it the same way.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { saveLease } from "./leases.js";
import { addCoTenant } from "./tenants.js";

const TIMESTAMP = "2026-10-31T00:00:00.000Z";

// Stateful fake supabase client: memberships behave like the real tables so
// the save-then-add flow can be driven end to end at the action layer.
// save_rental_lease inserts members as co_tenant (column default); the
// set_rental_primary_tenant RPC demotes existing primaries and promotes one.
function makeClient(state) {
  const rpcCalls = [];
  function filtered(table, filters) {
    const rows = state[table] || [];
    return rows.filter((row) => filters.every(([column, value]) => row[column] === value));
  }
  function chain(table) {
    const filters = [];
    const c = {
      select: () => c,
      eq: (column, value) => { filters.push([column, value]); return c; },
      insert: (row) => {
        if (table === "rental_lease_tenants") state.rental_lease_tenants.push({ ...row });
        c.inserted = row;
        return c;
      },
      maybeSingle: async () => {
        if (c.inserted) return { data: c.inserted, error: null };
        const rows = filtered(table, filters);
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve) => resolve({ data: filtered(table, filters), error: null }),
    };
    return c;
  }
  return {
    rpcCalls,
    from: (table) => chain(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "set_rental_primary_tenant") {
        const members = state.rental_lease_tenants.filter(
          (row) => row.owner_id === args.p_owner_id && row.lease_id === args.p_lease_id);
        if (!members.some((row) => row.tenant_id === args.p_tenant_id))
          return { data: null, error: new Error("Tenant is not a member of this lease.") };
        for (const row of members) row.occupancy_role = "co_tenant";
        members.find((row) => row.tenant_id === args.p_tenant_id).occupancy_role = "primary";
      }
      return { data: null, error: null };
    },
  };
}

function leaseBody(tenantIds, id = "lease_1") {
  return { lease: { id, propertyId: "prop_1", unitId: "unit_1", tenantIds,
    status: "draft", startDate: "2026-11-07", endDate: null, monthlyRentCents: 207500,
    currencyCode: "USD", rentDueDay: 1, notes: null } };
}

// Production-shaped save: the save RPC inserts the picked tenants as
// co_tenant members; the action under test then promotes exactly one.
function savingApplication(client, state) {
  return {
    saveLease: async (lease) => {
      state.rental_leases.push({ owner_id: "owner_1", id: lease.id });
      for (const tenantId of lease.tenantIds)
        state.rental_lease_tenants.push({ owner_id: "owner_1", lease_id: lease.id, tenant_id: tenantId, occupancy_role: "co_tenant" });
      return lease;
    },
  };
}

describe("saveLease primary-on-create", () => {
  let state;
  let client;
  beforeEach(() => {
    state = {
      rental_leases: [],
      rental_tenants: [
        { owner_id: "owner_1", id: "tenant_1", display_name: "Jacquelyn Parmenter", email: "jackie@example.com" },
        { owner_id: "owner_1", id: "tenant_2", display_name: "Taylor Parmenter", email: "taylor@example.com" },
      ],
      rental_lease_tenants: [],
    };
    client = makeClient(state);
  });

  it("promotes the first picked tenant to primary on a brand-new lease", async () => {
    const authenticated = { user: { id: "owner_1" }, supabaseClient: client };
    const response = await saveLease({ authenticated, body: leaseBody(["tenant_1"]), application: savingApplication(client, state), effectiveOwnerId: "owner_1", timestamp: TIMESTAMP });
    expect(response.status).toBe(200);
    expect(client.rpcCalls).toEqual([{ name: "set_rental_primary_tenant",
      args: { p_owner_id: "owner_1", p_lease_id: "lease_1", p_tenant_id: "tenant_1" } }]);
    expect(state.rental_lease_tenants).toEqual([
      { owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }]);
  });

  it("keeps the existing primary when another member is added on a re-save (no second primary)", async () => {
    state.rental_leases.push({ id: "lease_1" });
    state.rental_lease_tenants.push(
      { owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" });
    const authenticated = { user: { id: "owner_1" }, supabaseClient: client };
    // Re-save with the primary first in the picked list but a new member added:
    // the RPC wipe would otherwise leave the lease primary-less.
    const application = { saveLease: async (lease) => {
      state.rental_lease_tenants = state.rental_lease_tenants.filter((row) => row.lease_id !== "lease_1");
      for (const tenantId of lease.tenantIds)
        state.rental_lease_tenants.push({ owner_id: "owner_1", lease_id: "lease_1", tenant_id: tenantId, occupancy_role: "co_tenant" });
      return lease;
    } };
    const response = await saveLease({ authenticated, body: leaseBody(["tenant_1", "tenant_2"]), application, effectiveOwnerId: "owner_1", timestamp: TIMESTAMP });
    expect(response.status).toBe(200);
    expect(client.rpcCalls).toEqual([{ name: "set_rental_primary_tenant",
      args: { p_owner_id: "owner_1", p_lease_id: "lease_1", p_tenant_id: "tenant_1" } }]);
    expect(state.rental_lease_tenants.filter((row) => row.occupancy_role === "primary")).toHaveLength(1);
    expect(state.rental_lease_tenants.find((row) => row.tenant_id === "tenant_2").occupancy_role).toBe("co_tenant");
  });

  it("promotes the first remaining tenant when the old primary was removed from the lease", async () => {
    state.rental_leases.push({ id: "lease_1" });
    state.rental_lease_tenants.push(
      { owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" });
    const authenticated = { user: { id: "owner_1" }, supabaseClient: client };
    const application = { saveLease: async (lease) => {
      state.rental_lease_tenants = state.rental_lease_tenants.filter((row) => row.lease_id !== "lease_1");
      for (const tenantId of lease.tenantIds)
        state.rental_lease_tenants.push({ owner_id: "owner_1", lease_id: "lease_1", tenant_id: tenantId, occupancy_role: "co_tenant" });
      return lease;
    } };
    const response = await saveLease({ authenticated, body: leaseBody(["tenant_2"]), application, effectiveOwnerId: "owner_1", timestamp: TIMESTAMP });
    expect(response.status).toBe(200);
    expect(client.rpcCalls).toEqual([{ name: "set_rental_primary_tenant",
      args: { p_owner_id: "owner_1", p_lease_id: "lease_1", p_tenant_id: "tenant_2" } }]);
  });

  it("lets a second tenant be added right after creation with no primary detour (the Kent trap, closed)", async () => {
    const authenticated = { user: { id: "owner_1" }, supabaseClient: client };
    const application = savingApplication(client, state);
    // Old shape: the lease exists but its only member landed co_tenant with
    // no primary, so adding the second tenant is refused.
    state.rental_leases.push({ owner_id: "owner_1", id: "lease_1" });
    state.rental_lease_tenants.push({ owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "co_tenant" });
    const refused = await addCoTenant({ authenticated, body: { leaseId: "lease_1", tenantId: "tenant_2" }, effectiveOwnerId: "owner_1" });
    expect(refused.status).toBe(409);
    // New shape: the same lease created through saveLease promotes the
    // first tenant, so adding the second succeeds immediately.
    state.rental_leases = [];
    state.rental_lease_tenants = [];
    const saved = await saveLease({ authenticated, body: leaseBody(["tenant_1"]), application, effectiveOwnerId: "owner_1", timestamp: TIMESTAMP });
    expect(saved.status).toBe(200);
    const added = await addCoTenant({ authenticated, body: { leaseId: "lease_1", tenantId: "tenant_2" }, effectiveOwnerId: "owner_1" });
    expect(added.status).toBe(200);
    expect((await added.json()).membership).toEqual(expect.objectContaining({ lease_id: "lease_1", tenant_id: "tenant_2", occupancy_role: "co_tenant" }));
    expect(state.rental_lease_tenants.filter((row) => row.occupancy_role === "primary")).toEqual([
      expect.objectContaining({ tenant_id: "tenant_1" })]);
  });
});
