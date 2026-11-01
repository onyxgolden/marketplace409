import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { createSupportCase } from "./maintenance.js";

const rpcCalls = [];
function fakeClient({ tenant = { id: "tenant_1" }, insertError = null } = {}) {
  const table = (name) => ({
    select: () => table(name),
    eq: () => table(name),
    maybeSingle: async () => ({ data: tenant, error: null }),
    insert: (row) => {
      rpcCalls.push({ table: name, row });
      return {
        select: () => ({ single: async () => ({ data: { ...row }, error: insertError }) }),
        then: (resolve) => resolve({ data: null, error: insertError }),
      };
    },
  });
  return { from: (name) => table(name) };
}
function call(client, supportCase) {
  return createSupportCase({
    authenticated: { user: { id: "user_1" }, supabaseClient: client },
    body: { supportCase },
    effectiveOwnerId: "owner_1",
  });
}

describe("create-support-case (controls-sweep follow-up G25, O-20)", () => {
  beforeEach(() => { rpcCalls.length = 0; });

  it("creates an open case for a tenant and records the opened event", async () => {
    const response = await call(fakeClient(), { tenantId: "tenant_1", title: "Heater is out", caseType: "other" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.supportCase.status).toBe("open");
    expect(body.supportCase.title).toBe("Heater is out");
    const caseInsert = rpcCalls.find((c) => c.table === "rental_support_cases");
    expect(caseInsert.row.status).toBe("open");
    expect(caseInsert.row.created_by).toBe("user_1");
    const eventInsert = rpcCalls.find((c) => c.table === "rental_support_case_events");
    expect(eventInsert.row.event_type).toBe("opened");
  });

  it("rejects a missing title and an unknown case type", async () => {
    const noTitle = await call(fakeClient(), { tenantId: "tenant_1", title: "  " });
    expect(noTitle.status).toBe(400);
    const badType = await call(fakeClient(), { tenantId: "tenant_1", title: "x", caseType: "nope" });
    expect(badType.status).toBe(400);
  });

  it("rejects a tenant that does not belong to the owner", async () => {
    const response = await call(fakeClient({ tenant: null }), { tenantId: "tenant_1", title: "Heater is out" });
    expect(response.status).toBe(404);
  });
});
