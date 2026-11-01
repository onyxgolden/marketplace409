import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route.js";
import { chicagoSlotFor, LEDGER_STATES } from "@/application/notifications/scheduledSendLedger";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: () => ({ send: mocks.send }),
}));

let DB;
let updateCalls;

function matches(row, filters) {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.op === "eq") return v === f.val;
    if (f.op === "is") return f.val === null ? v === null || v === undefined : v === f.val;
    if (f.op === "in") return f.val.includes(v);
    return true;
  });
}

function ledgerChainable() {
  const rows = DB.scheduled_send_ledger;
  const keyOf = (r) => `${r.schedule_name}|${r.scheduled_slot}|${r.recipient_allowlist_id}`;
  const obj = {
    _filters: [],
    _patch: null,
    select() { return obj; },
    eq(col, val) { obj._filters.push({ op: "eq", col, val }); return obj; },
    async maybeSingle() {
      return { data: rows.find((r) => matches(r, obj._filters)) ?? null, error: null };
    },
    upsert(row, options) {
      const exists = rows.some((r) => keyOf(r) === keyOf(row));
      return {
        select: () => ({
          then: (resolve) => {
            if (exists && options?.ignoreDuplicates) return resolve({ data: [], error: null });
            const inserted = { id: `ledger_${rows.length + 1}`, ...row };
            rows.push(inserted);
            resolve({ data: [inserted], error: null });
          },
        }),
      };
    },
    update(patch) { obj._patch = patch; return obj; },
    then(resolve) {
      if (!obj._patch) return resolve({ data: rows.filter((r) => matches(r, obj._filters)), error: null });
      const matched = rows.filter((r) => matches(r, obj._filters));
      for (const row of matched) Object.assign(row, obj._patch);
      return resolve({ data: matched, error: null });
    },
  };
  return obj;
}

function chainable(table) {
  if (table === "scheduled_send_ledger") return ledgerChainable();
  const rows = DB[table] ?? [];
  const obj = {
    _filters: [],
    _patch: null,
    select() { return obj; },
    eq(col, val) { obj._filters.push({ op: "eq", col, val }); return obj; },
    is(col, val) { obj._filters.push({ op: "is", col, val }); return obj; },
    in(col, val) { obj._filters.push({ op: "in", col, val }); return obj; },
    async maybeSingle() {
      return { data: rows.find((r) => matches(r, obj._filters)) ?? null, error: null };
    },
    update(patch) { obj._patch = patch; return obj; },
    then(resolve) {
      if (!obj._patch) return resolve({ data: rows.filter((r) => matches(r, obj._filters)), error: null });
      const matched = rows.filter((r) => matches(r, obj._filters));
      for (const row of matched) Object.assign(row, obj._patch);
      updateCalls.push({ table, patch: obj._patch, ids: matched.map((r) => r.id) });
      return resolve({ data: matched, error: null });
    },
  };
  return obj;
}

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({ from: (table) => chainable(table) }),
}));

function tenant(id, overrides = {}) {
  return { id, display_name: `Tenant ${id}`, email: `${id}@example.com`, status: "inactive",
    auth_user_id: null, invited_at: null, ...overrides };
}

function seed({ tenants, memberships, leases, units }) {
  DB = {
    rental_tenants: tenants,
    rental_lease_tenants: memberships,
    rental_leases: leases,
    rental_units: units,
    scheduled_send_ledger: [],
  };
}

function authedRequest(path = "/api/rental/cron/tenant-invite") {
  return new Request(`http://localhost${path}`, { headers: { authorization: "Bearer cron-secret" } });
}

const ACTIVE_LEASE = { id: "lease_active", unit_id: "unit_1", start_date: "2026-10-01",
  monthly_rent_cents: 185000, status: "active" };
const DRAFT_LEASE = { id: "lease_draft", unit_id: "unit_1", start_date: "2026-11-01",
  monthly_rent_cents: 185000, status: "draft" };

describe("generalized tenant-invite sweep", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.send.mockResolvedValue({ id: "resend_1" });
    updateCalls = [];
    vi.clearAllMocks();
    mocks.send.mockResolvedValue({ id: "resend_1" });
  });

  it("rejects callers without the cron secret", async () => {
    const response = await GET(new Request("http://localhost/api/rental/cron/tenant-invite"));
    expect(response.status).toBe(401);
  });

  it("sends to an eligible tenant on an active lease and stamps invited_at + status", async () => {
    seed({
      tenants: [tenant("tenant_1")],
      memberships: [{ tenant_id: "tenant_1", lease_id: "lease_active" }],
      leases: [ACTIVE_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const response = await GET(authedRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toEqual(["tenant_1"]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: "tenant_1@example.com" }));
    expect(DB.rental_tenants[0].invited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(DB.rental_tenants[0].status).toBe("invited");
  });

  it("does NOT send to an already-claimed tenant", async () => {
    seed({
      tenants: [tenant("tenant_1", { auth_user_id: "auth_1", status: "active" })],
      memberships: [{ tenant_id: "tenant_1", lease_id: "lease_active" }],
      leases: [ACTIVE_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const body = await (await GET(authedRequest())).json();
    expect(body.sent).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does NOT send to a tenant whose only lease is a draft", async () => {
    seed({
      tenants: [tenant("tenant_1")],
      memberships: [{ tenant_id: "tenant_1", lease_id: "lease_draft" }],
      leases: [DRAFT_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const body = await (await GET(authedRequest())).json();
    expect(body.sent).toEqual([]);
    expect(body.skipped.noActiveLease).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does NOT send to a tenant without an email", async () => {
    seed({
      tenants: [tenant("tenant_1", { email: null })],
      memberships: [{ tenant_id: "tenant_1", lease_id: "lease_active" }],
      leases: [ACTIVE_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const body = await (await GET(authedRequest())).json();
    expect(body.sent).toEqual([]);
    expect(body.skipped.noEmail).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does NOT send to a tenant who was already sent an invite", async () => {
    seed({
      tenants: [tenant("tenant_1", { invited_at: "2026-10-31T12:00:00.000Z", status: "invited" })],
      memberships: [{ tenant_id: "tenant_1", lease_id: "lease_active" }],
      leases: [ACTIVE_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const body = await (await GET(authedRequest())).json();
    expect(body.sent).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends to the eligible tenants and skips the rest in one mixed run", async () => {
    seed({
      tenants: [
        tenant("tenant_ok"),
        tenant("tenant_draft"),
        tenant("tenant_noemail", { email: "  " }),
        tenant("tenant_claimed", { auth_user_id: "auth_9", status: "active" }),
      ],
      memberships: [
        { tenant_id: "tenant_ok", lease_id: "lease_active" },
        { tenant_id: "tenant_draft", lease_id: "lease_draft" },
        { tenant_id: "tenant_noemail", lease_id: "lease_active" },
        { tenant_id: "tenant_claimed", lease_id: "lease_active" },
      ],
      leases: [ACTIVE_LEASE, DRAFT_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const body = await (await GET(authedRequest())).json();
    expect(body.sent).toEqual(["tenant_ok"]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("dryRun lists would-be sends without sending or stamping", async () => {
    seed({
      tenants: [tenant("tenant_1")],
      memberships: [{ tenant_id: "tenant_1", lease_id: "lease_active" }],
      leases: [ACTIVE_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const body = await (await GET(authedRequest("/api/rental/cron/tenant-invite?dryRun=true"))).json();
    expect(body.wouldSend).toHaveLength(1);
    expect(body.wouldSend[0].tenantId).toBe("tenant_1");
    expect(body.sent).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(DB.rental_tenants[0].invited_at).toBeNull();
  });

  it("reconciles positive ledger evidence instead of resending", async () => {
    seed({
      tenants: [tenant("tenant_1")],
      memberships: [{ tenant_id: "tenant_1", lease_id: "lease_active" }],
      leases: [ACTIVE_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    DB.scheduled_send_ledger.push({
      id: "ledger_1", schedule_name: "tenant_invite", scheduled_slot: chicagoSlotFor(),
      recipient_allowlist_id: "tenant_1", run_id: "earlier_run", state: LEDGER_STATES.PROVIDER_ACCEPTED,
      provider_request_key: "key_1", payload_digest: "digest_1",
    });
    const body = await (await GET(authedRequest())).json();
    expect(body.reconciled).toEqual(["tenant_1"]);
    expect(body.sent).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(DB.rental_tenants[0].invited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records a _sweep no_op row when there is nothing to send", async () => {
    seed({ tenants: [], memberships: [], leases: [], units: [] });
    const body = await (await GET(authedRequest())).json();
    expect(body.action).toBe("no_candidates");
    expect(body.sent).toEqual([]);
    const sweepRow = DB.scheduled_send_ledger.find((r) => r.recipient_allowlist_id === "_sweep");
    expect(sweepRow).toBeDefined();
    expect(sweepRow.state).toBe(LEDGER_STATES.NO_OP);
  });

  it("fails a tenant closed on a provider error without aborting the run", async () => {
    mocks.send.mockRejectedValueOnce(new Error("provider down"));
    seed({
      tenants: [tenant("tenant_bad"), tenant("tenant_ok")],
      memberships: [
        { tenant_id: "tenant_bad", lease_id: "lease_active" },
        { tenant_id: "tenant_ok", lease_id: "lease_active" },
      ],
      leases: [ACTIVE_LEASE],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
    });
    const body = await (await GET(authedRequest())).json();
    expect(body.sent).toEqual(["tenant_ok"]);
    expect(body.skipped.failed).toBe(1);
    expect(DB.rental_tenants.find((t) => t.id === "tenant_bad").invited_at).toBeNull();
  });
});
