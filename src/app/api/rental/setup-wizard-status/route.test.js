import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: mocks.authenticate,
}));

import { GET } from "./route";

// Minimal thenable query builder: every chain method returns the builder, and
// awaiting it resolves the canned result for the table.
function fakeQuery(result) {
  const builder = {};
  for (const method of ["select", "eq", "neq", "in", "order", "limit", "maybeSingle"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve) => resolve(result);
  return builder;
}

function fakeClient(tables) {
  return { from: (table) => fakeQuery(tables[table] ?? { data: [], error: null }) };
}

function authed(client) {
  mocks.authenticate.mockResolvedValue({
    response: null,
    user: { id: "user-1" },
    supabaseClient: client,
    effectiveOwnerId: "owner-1",
  });
}

describe("GET /api/rental/setup-wizard-status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports unsetup with all steps pending for a fresh workspace", async () => {
    authed(fakeClient({
      rental_units: { data: [], error: null },
      rental_tenants: { data: [], error: null },
      financial_accounts: { data: [], error: null },
      rental_billing_settings: { data: null, error: null },
      rental_email_settings: { data: null, error: null },
      rental_late_fee_rules: { data: [], error: null },
      workspace_members: { data: [{ id: "m1", status: "active" }], error: null },
    }));
    const response = await GET();
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.unsetup).toBe(true);
    expect(body.steps).toHaveLength(6);
    expect(body.steps.map((step) => step.id)).toEqual(["settings", "banking", "owners", "managers", "properties", "tenants"]);
    const byId = Object.fromEntries(body.steps.map((step) => [step.id, step.complete]));
    expect(byId).toEqual({ settings: false, banking: false, owners: true, managers: false, properties: false, tenants: false });
  });

  it("derives completion from data: settings, banking, members, property, tenant", async () => {
    authed(fakeClient({
      rental_units: { data: [{ id: "u1", status: "active" }], error: null },
      rental_tenants: { data: [{ id: "t1" }], error: null },
      financial_accounts: { data: [{ id: "a1" }], error: null },
      rental_billing_settings: { data: null, error: null },
      rental_email_settings: { data: { owner_id: "owner-1" }, error: null },
      rental_late_fee_rules: { data: [], error: null },
      workspace_members: { data: [{ id: "m1", status: "active" }, { id: "m2", status: "invited" }], error: null },
    }));
    const response = await GET();
    const body = await response.json();
    expect(body.unsetup).toBe(false);
    const byId = Object.fromEntries(body.steps.map((step) => [step.id, step.complete]));
    expect(byId.settings).toBe(true);
    expect(byId.banking).toBe(true);
    expect(byId.managers).toBe(true);
    expect(byId.properties).toBe(true);
    expect(byId.tenants).toBe(true);
    expect(body.completeCount).toBe(body.totalCount);
  });

  it("treats an archived-only workspace as unsetup", async () => {
    authed(fakeClient({
      rental_units: { data: [{ id: "u1", status: "inactive" }], error: null },
    }));
    const response = await GET();
    const body = await response.json();
    expect(body.unsetup).toBe(true);
    expect(body.steps.find((step) => step.id === "properties").complete).toBe(false);
  });

  it("returns 500 when a count query fails", async () => {
    authed(fakeClient({
      rental_units: { data: null, error: new Error("db down") },
    }));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Unable to load setup progress.");
  });

  it("passes through the auth gate response", async () => {
    const gated = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    mocks.authenticate.mockResolvedValue({ response: gated });
    const response = await GET();
    expect(response).toBe(gated);
  });
});
