import { beforeEach, describe, expect, it, vi } from "vitest";

let workspaceRole = null;
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => workspaceRole),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// Per-test supabase behavior: maybeSingle answers are consumed in call order
// per table (the handlers query each table a fixed number of times), list
// answers resolve when a select chain is awaited directly.
let maybeSingleQueues = {};
let listResults = {};
const insertCalls = [];
const deleteCalls = [];
const eqCalls = [];
function chainable(table) {
  const chain = {
    select: () => chain,
    eq: (column, value) => { eqCalls.push({ table, column, value }); return chain; },
    is: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: (maybeSingleQueues[table] || []).shift() ?? null, error: null }),
    insert: (row) => { insertCalls.push({ table, row }); return chain; },
    delete: () => { deleteCalls.push({ table }); return chain; },
    update: (patch) => chain,
    then: (resolve) => resolve({ data: listResults[table] ?? null, error: null }),
  };
  return chain;
}
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({
    application: {}, user: { id: "owner_1" }, effectiveOwnerId: "owner_1",
    supabaseClient: { from: (table) => chainable(table) },
  })),
}));

import { POST } from "./route.js";

function request(body) {
  return new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) });
}

const lease = { id: "lease_1" };
const primary = { id: "tenant_1", display_name: "Primary Renter", email: "primary@example.com" };
const spouse = { id: "tenant_2", display_name: "Second Renter", email: "second@example.com" };

describe("add-co-tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRole = null;
    maybeSingleQueues = {};
    listResults = {};
    insertCalls.length = 0;
    deleteCalls.length = 0;
    eqCalls.length = 0;
  });

  it("inserts a co_tenant membership for an existing tenant on an existing lease", async () => {
    maybeSingleQueues = {
      rental_leases: [lease],
      rental_tenants: [spouse],
      rental_lease_tenants: [null, { lease_id: "lease_1", tenant_id: "tenant_2", occupancy_role: "co_tenant" }],
    };
    listResults = { rental_lease_tenants: [{ tenant_id: "tenant_1", occupancy_role: "primary" }] };
    const response = await POST(request({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual({ table: "rental_lease_tenants",
      row: { owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_2", occupancy_role: "co_tenant" } });
  });

  it("returns 409 when the tenant is already on the lease", async () => {
    maybeSingleQueues = {
      rental_leases: [lease],
      rental_tenants: [spouse],
      rental_lease_tenants: [{ tenant_id: "tenant_2", occupancy_role: "co_tenant" }],
    };
    const response = await POST(request({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(409);
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 409 with a primary-specific message when the tenant is already the primary", async () => {
    maybeSingleQueues = {
      rental_leases: [lease],
      rental_tenants: [primary],
      rental_lease_tenants: [{ tenant_id: "tenant_1", occupancy_role: "primary" }],
    };
    const response = await POST(request({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "tenant_1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("primary tenant") });
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 404 for an unknown lease and for an unknown tenant", async () => {
    maybeSingleQueues = { rental_leases: [null] };
    const noLease = await POST(request({ operation: "add-co-tenant", leaseId: "lease_x", tenantId: "tenant_2" }));
    expect(noLease.status).toBe(404);
    maybeSingleQueues = { rental_leases: [lease], rental_tenants: [null] };
    const noTenant = await POST(request({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "tenant_x" }));
    expect(noTenant.status).toBe(404);
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 409 when the lease has no primary tenant yet", async () => {
    maybeSingleQueues = {
      rental_leases: [lease],
      rental_tenants: [spouse],
      rental_lease_tenants: [null],
    };
    listResults = { rental_lease_tenants: [] };
    const response = await POST(request({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(409);
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 403 for a read-only caller without touching memberships", async () => {
    workspaceRole = "read_only";
    const response = await POST(request({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(403);
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 400 when leaseId or tenantId is missing", async () => {
    const noLease = await POST(request({ operation: "add-co-tenant", tenantId: "tenant_2" }));
    expect(noLease.status).toBe(400);
    const noTenant = await POST(request({ operation: "add-co-tenant", leaseId: "lease_1" }));
    expect(noTenant.status).toBe(400);
  });
});

describe("remove-co-tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRole = null;
    maybeSingleQueues = {};
    listResults = {};
    insertCalls.length = 0;
    deleteCalls.length = 0;
    eqCalls.length = 0;
  });

  it("deletes a co-tenant membership and leaves the tenant record alone", async () => {
    maybeSingleQueues = { rental_lease_tenants: [{ tenant_id: "tenant_2", occupancy_role: "co_tenant" }] };
    const response = await POST(request({ operation: "remove-co-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(deleteCalls).toEqual([{ table: "rental_lease_tenants" }]);
    expect(eqCalls).toContainEqual({ table: "rental_lease_tenants", column: "lease_id", value: "lease_1" });
    expect(eqCalls).toContainEqual({ table: "rental_lease_tenants", column: "tenant_id", value: "tenant_2" });
  });

  it("returns 404 when the tenant is not on the lease", async () => {
    maybeSingleQueues = { rental_lease_tenants: [null] };
    const response = await POST(request({ operation: "remove-co-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(404);
    expect(deleteCalls).toHaveLength(0);
  });

  it("refuses to remove the primary membership", async () => {
    maybeSingleQueues = { rental_lease_tenants: [{ tenant_id: "tenant_1", occupancy_role: "primary" }] };
    const response = await POST(request({ operation: "remove-co-tenant", leaseId: "lease_1", tenantId: "tenant_1" }));
    expect(response.status).toBe(409);
    expect(deleteCalls).toHaveLength(0);
  });

  it("returns 403 for a read-only caller without deleting anything", async () => {
    workspaceRole = "read_only";
    const response = await POST(request({ operation: "remove-co-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(403);
    expect(deleteCalls).toHaveLength(0);
  });

  it("returns 400 when leaseId or tenantId is missing", async () => {
    const noLease = await POST(request({ operation: "remove-co-tenant", tenantId: "tenant_2" }));
    expect(noLease.status).toBe(400);
    const noTenant = await POST(request({ operation: "remove-co-tenant", leaseId: "lease_1" }));
    expect(noTenant.status).toBe(400);
  });
});
