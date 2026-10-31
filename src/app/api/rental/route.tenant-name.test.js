import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// update-tenant-profile chain: .update(patch).eq().eq().select().maybeSingle()
let maybeSingleResult = null;
const updateCalls = [];
function chainable(table) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: maybeSingleResult, error: null }),
    update: (patch) => { updateCalls.push({ table, patch }); return chain; },
    then: (resolve) => resolve({ data: null, error: null }),
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

describe("update-tenant-profile displayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingleResult = { id: "tenant_1", display_name: "New Name" };
    updateCalls.length = 0;
  });

  function profileRequest(profile) {
    return POST(request({ operation: "update-tenant-profile", tenantId: "tenant_1", profile }));
  }

  it("trims and writes display_name without touching email or identity columns", async () => {
    const response = await profileRequest({ displayName: "  New Name  ", phone: "555-1000" });
    expect(response.status).toBe(200);
    expect((await response.json()).tenant).toEqual({ id: "tenant_1", display_name: "New Name" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("rental_tenants");
    expect(updateCalls[0].patch.display_name).toBe("New Name");
    expect(updateCalls[0].patch).not.toHaveProperty("email");
    expect(updateCalls[0].patch).not.toHaveProperty("id");
  });

  it("rejects an empty or whitespace-only name without writing anything", async () => {
    const empty = await profileRequest({ displayName: "" });
    expect(empty.status).toBe(400);
    const blank = await profileRequest({ displayName: "   " });
    expect(blank.status).toBe(400);
    const nonString = await profileRequest({ displayName: 42 });
    expect(nonString.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("leaves the stored name alone when displayName is absent", async () => {
    const response = await profileRequest({ phone: "555-1000" });
    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch).not.toHaveProperty("display_name");
  });

  it("returns 404 for an unknown tenant", async () => {
    maybeSingleResult = null;
    const response = await profileRequest({ displayName: "New Name" });
    expect(response.status).toBe(404);
  });
});
