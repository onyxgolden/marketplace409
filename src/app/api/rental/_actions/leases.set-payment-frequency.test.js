import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { setPaymentFrequency } from "./leases.js";

const TIMESTAMP = "2026-11-02T00:00:00.000Z";

function makeClient({ schedule, lease, members = [], notifyError = null }) {
  const rpcCalls = [];
  const updates = [];
  function chain(table) {
    const filters = [];
    const c = {
      select: () => c,
      eq: (column, value) => { filters.push([column, value]); return c; },
      update: (row) => { c.updated = row; return c; },
      maybeSingle: async () => {
        if (table === "rent_schedules") {
          if (c.updated) {
            if (schedule && filters.every(([col, val]) => schedule[col] === val)) {
              Object.assign(schedule, c.updated);
              updates.push({ ...c.updated });
              return { data: { id: schedule.id, payment_frequency: schedule.payment_frequency }, error: null };
            }
            return { data: null, error: null };
          }
          const hit = schedule && filters.every(([col, val]) => schedule[col] === val) ? schedule : null;
          return { data: hit, error: null };
        }
        if (table === "rental_leases") {
          const hit = lease && filters.every(([col, val]) => lease[col] === val) ? lease : null;
          return { data: hit, error: null };
        }
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
  return {
    rpcCalls, updates,
    from: (table) => chain(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (notifyError) return { data: null, error: notifyError };
      return { data: { id: "msg_1" }, error: null };
    },
  };
}

function call(client, body) {
  return setPaymentFrequency({
    authenticated: { supabaseClient: client, user: { id: "user_1" } },
    body, effectiveOwnerId: "owner_1", timestamp: TIMESTAMP,
  });
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

const activeSchedule = () => ({ id: "schedule_1", status: "active", lease_id: "lease_1", payment_frequency: "monthly", owner_id: "owner_1" });
const activeLease = () => ({ id: "lease_1", status: "active", owner_id: "owner_1" });
const members = () => [
  { tenant_id: "tenant_9", occupancy_role: "co_tenant", owner_id: "owner_1", lease_id: "lease_1" },
  { tenant_id: "tenant_1", occupancy_role: "primary", owner_id: "owner_1", lease_id: "lease_1" },
];

describe("setPaymentFrequency (controls-sweep follow-up G8)", () => {
  it("rejects an unsupported frequency", async () => {
    const client = makeClient({ schedule: activeSchedule(), lease: activeLease() });
    const { status, body } = await json(await call(client, { scheduleId: "schedule_1", paymentFrequency: "daily" }));
    expect(status).toBe(400);
    expect(body.error).toMatch(/weekly, biweekly, or monthly/);
  });

  it("404s on an unknown schedule", async () => {
    const client = makeClient({ schedule: null, lease: activeLease() });
    const { status } = await json(await call(client, { scheduleId: "nope", paymentFrequency: "weekly" }));
    expect(status).toBe(404);
  });

  it("409s on a cancelled lease (G1 rule)", async () => {
    const client = makeClient({ schedule: activeSchedule(), lease: { id: "lease_1", status: "cancelled", owner_id: "owner_1" } });
    const { status, body } = await json(await call(client, { scheduleId: "schedule_1", paymentFrequency: "weekly" }));
    expect(status).toBe(409);
    expect(body.error).toMatch(/cancelled lease cannot be changed/);
  });

  it("409s on a non-active schedule", async () => {
    const client = makeClient({ schedule: { ...activeSchedule(), status: "paused" }, lease: activeLease() });
    const { status } = await json(await call(client, { scheduleId: "schedule_1", paymentFrequency: "weekly" }));
    expect(status).toBe(409);
  });

  it("returns unchanged without writing when the frequency already matches", async () => {
    const schedule = activeSchedule();
    const client = makeClient({ schedule, lease: activeLease(), members: members() });
    const { status, body } = await json(await call(client, { scheduleId: "schedule_1", paymentFrequency: "monthly" }));
    expect(status).toBe(200);
    expect(body.unchanged).toBe(true);
    expect(client.updates).toHaveLength(0);
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("updates the frequency, resets the anchor, and notifies the primary tenant", async () => {
    const schedule = activeSchedule();
    const client = makeClient({ schedule, lease: activeLease(), members: members() });
    const { status, body } = await json(await call(client, { scheduleId: "schedule_1", paymentFrequency: "weekly" }));
    expect(status).toBe(200);
    expect(body.tenantNotified).toBe(true);
    expect(schedule.payment_frequency).toBe("weekly");
    expect(schedule.payment_anchor_date).toBe("2026-11-02");
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0]).toMatchObject({ name: "send_rental_conversation_owner_message", args: { p_tenant_id: "tenant_1" } });
    expect(client.rpcCalls[0].args.p_body).toMatch(/from monthly to weekly/);
  });

  it("still succeeds with tenantNotified false when the tenant message fails", async () => {
    const schedule = activeSchedule();
    const client = makeClient({ schedule, lease: activeLease(), members: members(), notifyError: new Error("thread write failed") });
    const { status, body } = await json(await call(client, { scheduleId: "schedule_1", paymentFrequency: "biweekly" }));
    expect(status).toBe(200);
    expect(body.tenantNotified).toBe(false);
    expect(schedule.payment_frequency).toBe("biweekly");
  });
});
