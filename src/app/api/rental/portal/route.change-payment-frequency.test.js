// R13: tenant portal self-scheduling -- change-payment-frequency operation.
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_tenant_1",
  display_name: "Tyler Welch" };
const SCHEDULE = { id: "schedule_1", lease_id: "lease_1", payment_frequency: "monthly" };

let dbState;
let updateCalls;
let database;
const messageRpc = vi.fn(async () => ({ data: { id: "msg_1" }, error: null }));

function resolve(call) {
  const eq = Object.fromEntries(call.filters);
  if (call.table === "rental_tenants") {
    const tenant = dbState.tenant && eq.auth_user_id === dbState.tenant.auth_user_id ? dbState.tenant : null;
    return { data: tenant, error: null };
  }
  if (call.table === "rental_lease_tenants") {
    const membership = dbState.memberships.find((row) =>
      (!eq.lease_id || row.lease_id === eq.lease_id) && row.tenant_id === dbState.tenant.id) || null;
    return { data: membership, error: null };
  }
  if (call.table === "rental_billing_settings") return { data: dbState.settings, error: null };
  if (call.table === "rent_schedules") {
    if (call.op === "update") {
      updateCalls.push(call.values);
      dbState.schedule = { ...dbState.schedule, ...call.values };
      return { data: dbState.schedule, error: null };
    }
    const schedule = dbState.schedule && eq.lease_id === dbState.schedule.lease_id
      && (!eq.status || eq.status === "active") ? dbState.schedule : null;
    return { data: schedule, error: null };
  }
  return { data: null, error: null };
}

function makeDatabase() {
  return {
    from(table) {
      const call = { table, op: "select", values: null, filters: [] };
      const chain = {
        select() { return chain; },
        eq(column, value) { call.filters.push([column, value]); return chain; },
        update(values) { call.op = "update"; call.values = values; return chain; },
        maybeSingle: async () => resolve(call),
        single: async () => resolve(call),
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: vi.fn(() => database),
}));
vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: vi.fn(async () => ({
    user: { id: "auth_tenant_1" }, supabaseClient: { rpc: messageRpc }, application: {},
  })),
}));

import { POST } from "./route.js";

function post(body) {
  return POST(new Request("https://example.test/api/rental/portal", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

describe("change-payment-frequency", () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  beforeEach(() => {
    vi.clearAllMocks();
    dbState = { tenant: { ...TENANT }, memberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
      settings: null, schedule: { ...SCHEDULE } };
    updateCalls = [];
    database = makeDatabase();
  });
  const op = (overrides = {}) => post({ operation: "change-payment-frequency",
    leaseId: "lease_1", paymentFrequency: "weekly", ...overrides });

  it("updates the schedule, resets the anchor to today, and notifies the owner in the thread", async () => {
    const response = await op();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payment_frequency).toBe("weekly");
    expect(updateCalls[0].payment_anchor_date).toBe(todayStr);
    expect(messageRpc).toHaveBeenCalledWith("send_rental_conversation_tenant_message",
      expect.objectContaining({ p_body: expect.stringContaining("Tyler Welch") }));
    expect(messageRpc.mock.calls[0][1].p_body).toContain("weekly");
  });
  it("is a no-op success when the frequency is unchanged", async () => {
    const response = await op({ paymentFrequency: "monthly" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.unchanged).toBe(true);
    expect(updateCalls).toHaveLength(0);
    expect(messageRpc).not.toHaveBeenCalled();
  });
  it("403s a tenant who is not on the lease -- the lease id never leaks", async () => {
    dbState.memberships = [];
    const response = await op();
    expect(response.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
    expect(messageRpc).not.toHaveBeenCalled();
  });
  it("403s when the landlord disabled tenant schedule changes", async () => {
    dbState.settings = { tenant_may_change_payment_frequency: false };
    const response = await op();
    expect(response.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });
  it("409s when there is no active schedule for the lease", async () => {
    dbState.schedule = null;
    const response = await op();
    expect(response.status).toBe(409);
    expect(updateCalls).toHaveLength(0);
  });
  it("rejects an invalid frequency and a missing lease id before any write", async () => {
    expect((await op({ paymentFrequency: "fortnightly" })).status).toBe(400);
    expect((await op({ leaseId: "" })).status).toBe(400);
    expect(updateCalls).toHaveLength(0);
    expect(messageRpc).not.toHaveBeenCalled();
  });
});
