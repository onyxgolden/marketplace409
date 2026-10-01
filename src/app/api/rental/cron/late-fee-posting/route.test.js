import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET } from "./route.js";

function request(headers = {}, query = "") {
  return new Request(`https://test/api${query}`, { headers });
}

function chain(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), then: (resolve) => resolve(result) };
  return node;
}

// rent_charges is queried twice (candidate select + idempotency upsert) and
// each leg needs its own awaitable result.
function rentChargesDb({ candidates, upsertResult }) {
  const upsertNode = { select: vi.fn(() => upsertNode), then: (resolve) => resolve(upsertResult) };
  const upsert = vi.fn(() => upsertNode);
  const selectNode = { eq: vi.fn(() => selectNode), in: vi.fn(() => selectNode), then: (resolve) => resolve(candidates) };
  return { select: vi.fn(() => selectNode), upsert };
}

function db({ settings, overrides, candidates, leases, schedules, memberships, upsertResult }) {
  const charges = rentChargesDb({ candidates, upsertResult });
  return {
    charges,
    from: vi.fn((table) => {
      if (table === "rental_billing_settings") return chain(settings);
      if (table === "rental_late_fee_tenant_overrides") return chain(overrides);
      if (table === "rent_charges") return charges;
      if (table === "rental_leases") return chain(leases);
      if (table === "rent_schedules") return chain(schedules);
      if (table === "rental_lease_tenants") return chain(memberships);
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const SETTINGS = { data: [{ owner_id: "owner_1", late_fee_auto_post: true, late_fee_grace_days: 5,
  late_fee_calculation_type: "fixed", late_fee_fixed_amount_cents: 7500,
  late_fee_percentage_basis_points: null, late_fee_maximum_amount_cents: null }], error: null };
const EMPTY = { data: [], error: null };
const LEASES = { data: [{ id: "lease_1", status: "active" }], error: null };
const SCHEDULES = { data: [{ id: "schedule_1", collection_mode: "forge" }], error: null };
const MEMBERSHIPS = { data: [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }], error: null };

function charge(overrides = {}) {
  return { owner_id: "owner_1", id: "charge_1", lease_id: "lease_1", schedule_id: "schedule_1",
    charge_type: "rent", amount_cents: 160000, paid_amount_cents: 0, due_date: "2020-01-01",
    status: "due", currency_code: "USD", period: "2020-01", ...overrides };
}

function setup({ settings = SETTINGS, overrides = EMPTY, candidates = { data: [charge()], error: null },
  leases = LEASES, schedules = SCHEDULES, memberships = MEMBERSHIPS,
  upsertResult = { data: [{ id: "fee_1" }], error: null } } = {}) {
  const database = db({ settings, overrides, candidates, leases, schedules, memberships, upsertResult });
  createRentalWebhookClient.mockReturnValue(database);
  return database;
}

const AUTH = { authorization: "Bearer test-cron-secret" };

beforeEach(() => { process.env.CRON_SECRET = "test-cron-secret"; });

describe("late-fee auto-posting cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("posts one late fee for a rent charge past its grace period", async () => {
    const database = setup();
    const response = await GET(request(AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.evaluated).toBe(1);
    expect(body.posted).toBe(1);
    expect(body.failed).toBe(0);
    expect(database.charges.upsert).toHaveBeenCalledTimes(1);
    expect(database.charges.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "owner_1", charge_type: "late_fee",
        source_key: "latefee:auto:charge_1", amount_cents: 7500, related_charge_id: "charge_1",
        status: "due", currency_code: "USD" }),
      { onConflict: "owner_id,source_key", ignoreDuplicates: true });
  });

  it("posts nothing when no owner has auto-post enabled", async () => {
    const database = setup({ settings: EMPTY });
    const response = await GET(request(AUTH));
    const body = await response.json();
    expect(body.evaluated).toBe(0);
    expect(body.posted).toBe(0);
    expect(database.from).not.toHaveBeenCalledWith("rent_charges");
  });

  it("skips a charge still inside its grace period", async () => {
    const recentDue = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const database = setup({ candidates: { data: [charge({ due_date: recentDue })], error: null } });
    const response = await GET(request(AUTH));
    const body = await response.json();
    expect(body.evaluated).toBe(1);
    expect(body.posted).toBe(0);
    expect(body.skipped).toBe(1);
    expect(database.charges.upsert).not.toHaveBeenCalled();
  });

  it("skips the lease when the tenant is exempt", async () => {
    const database = setup({ overrides: { data: [{ owner_id: "owner_1", tenant_id: "tenant_1", exempt: true,
      grace_days: null, calculation_type: null, fixed_amount_cents: null,
      percentage_basis_points: null, maximum_amount_cents: null }], error: null } });
    const response = await GET(request(AUTH));
    const body = await response.json();
    expect(body.evaluated).toBe(1);
    expect(body.posted).toBe(0);
    expect(body.skipped).toBe(1);
    expect(database.charges.upsert).not.toHaveBeenCalled();
  });

  it("skips charges on inactive leases and non-FORGE schedules", async () => {
    const database = setup({
      candidates: { data: [charge({ id: "charge_2", lease_id: "lease_2" }), charge({ id: "charge_3", schedule_id: "schedule_3" })], error: null },
      leases: { data: [{ id: "lease_1", status: "active" }, { id: "lease_2", status: "ended" }], error: null },
      schedules: { data: [{ id: "schedule_1", collection_mode: "forge" }, { id: "schedule_3", collection_mode: "external" }], error: null },
    });
    const response = await GET(request(AUTH));
    const body = await response.json();
    expect(body.evaluated).toBe(0);
    expect(body.posted).toBe(0);
    expect(database.charges.upsert).not.toHaveBeenCalled();
  });

  it("never double-posts: an existing source key counts as skipped, not posted", async () => {
    const database = setup({ upsertResult: { data: [], error: null } });
    const response = await GET(request(AUTH));
    const body = await response.json();
    expect(body.evaluated).toBe(1);
    expect(body.posted).toBe(0);
    expect(body.skipped).toBe(1);
    expect(database.charges.upsert).toHaveBeenCalledTimes(1);
  });

  it("dryRun evaluates without writing anything", async () => {
    const database = setup();
    const response = await GET(request(AUTH, "?dryRun=true"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.wouldPost).toBe(1);
    expect(body.posted).toBe(0);
    expect(database.charges.upsert).not.toHaveBeenCalled();
  });
});
