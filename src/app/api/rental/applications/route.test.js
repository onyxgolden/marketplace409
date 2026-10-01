import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET } from "./route";
import { GET as getOne } from "./[id]/route";
import { POST as decide } from "./[id]/decision/route";

// Per-table stub: tables[name] = { oneRow, listRows, insertedRow, updatedRow,
// insertError }. Records every insert/update for assertions.
function makeDb(tables = {}, cfg_rpc = {}) {
  const rpcCalls = [];
  const calls = { insert: [], update: [], from: [], rpc: rpcCalls };
  const db = {
    rpc: vi.fn(async (name, args) => {
      rpcCalls.push({ name, args });
      if (cfg_rpc.error) return { data: null, error: cfg_rpc.error };
      return { data: cfg_rpc.data, error: null };
    }),
    from: vi.fn((name) => {
      calls.from.push(name);
      const cfg = tables[name] || {};
      const table = {
        select() { return table; },
        rpc() { return table; },
        eq() { return table; },
        in() { return table; },
        order() { return table; },
        gte() { return table; },
        limit() { return table; },
        insert(payload) {
          calls.insert.push({ table: name, payload });
          return table;
        },
        update(payload) { calls.update.push({ table: name, payload }); return table; },
        async maybeSingle() { return { data: cfg.oneRow ?? null, error: null }; },
        async single() {
          if (cfg.insertError) return { data: null, error: cfg.insertError };
          if (calls.insert.some((call) => call.table === name)) return { data: cfg.insertedRow, error: null };
          return { data: cfg.updatedRow, error: null };
        },
        then(resolve) {
          if (cfg.insertError && calls.insert.some((call) => call.table === name)) {
            resolve({ data: null, error: cfg.insertError });
          } else {
            resolve({ data: cfg.listRows || [], error: null });
          }
        },
      };
      return table;
    }),
  };
  return { db, calls };
}

const APP_ROW = {
  id: "app_1", listing_id: "listing_1", form_id: "form_1", status: "pending",
  answers: { personal: { firstName: "Sam", lastName: "Applicant", email: "sam@example.com", phone: "555-0100" }, consent: true },
  fee_amount_cents: 2500, fee_recorded: true, denial_reason: null,
  tenant_id: null, lease_id: null, decided_by: null, decided_at: null,
  submitted_at: "2026-10-01T08:00:00Z",
};
const LISTING_ROW = { id: "listing_1", title: "Sunny 2-bed", public_slug: "abcDEF123456", unit_id: "unit_1", property_id: "prop_1", rent_cents: 160000 };

function auth(db, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    supabaseClient: db, user: { id: "user_1" }, effectiveOwnerId: "owner_1",
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const postDecision = (id, body) => decide(
  new Request("https://t/", { method: "POST", body: JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);
const getById = (id) => getOne(new Request("https://t/"), { params: Promise.resolve({ id }) });

describe("applications queue", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("lists pending applications with their listing titles", async () => {
    const { db } = makeDb({
      rental_applications: { listRows: [APP_ROW] },
      rental_listings: { listRows: [LISTING_ROW] },
    });
    auth(db);
    const response = await GET(new Request("https://t/?status=pending"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].listing.title).toBe("Sunny 2-bed");
  });

  it("400s on an invalid status filter", async () => {
    const { db } = makeDb();
    auth(db);
    expect((await GET(new Request("https://t/?status=bogus"))).status).toBe(400);
  });

  it("loads the review detail with decisions", async () => {
    const { db } = makeDb({
      rental_applications: { oneRow: APP_ROW },
      rental_listings: { oneRow: LISTING_ROW },
      rental_application_decisions: { listRows: [] },
    });
    auth(db);
    const response = await getById("app_1");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.application.id).toBe("app_1");
    expect(body.listing.title).toBe("Sunny 2-bed");
    expect(body.decisions).toEqual([]);
  });

  it("404s an unknown application", async () => {
    const { db } = makeDb();
    auth(db);
    expect((await getById("nope")).status).toBe(404);
  });
});

describe("application decision", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const RPC_OK_DENY = { decision_id: "dec_1", action: "denied", tenant_id: null, lease_id: null };
  const RPC_OK_APPROVE = { decision_id: "dec_1", action: "approved", tenant_id: "rental_tenant_x", lease_id: "rental_lease_y" };

  it("403s decisions for read-only members", async () => {
    const { db } = makeDb({ rental_applications: { oneRow: APP_ROW } });
    auth(db, "read_only");
    expect((await postDecision("app_1", { action: "deny", reason: "X" })).status).toBe(403);
  });

  it("404s an unknown application", async () => {
    const { db } = makeDb({});
    auth(db);
    expect((await postDecision("nope", { action: "deny", reason: "X" })).status).toBe(404);
  });

  it("denies with a reason through a single RPC call", async () => {
    const { db, calls } = makeDb({ rental_applications: { oneRow: APP_ROW } }, { data: RPC_OK_DENY });
    auth(db);
    const response = await postDecision("app_1", { action: "deny", reason: "Income insufficient" });
    const body = await response.json();
    expect(response.status).toBe(200);
    // Exactly one RPC call — no separate table writes from the route.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("decide_rental_application");
    expect(calls.rpc[0].args.p_action).toBe("deny");
    expect(calls.rpc[0].args.p_reason).toBe("Income insufficient");
    expect(calls.rpc[0].args.p_owner_id).toBe("owner_1");
    expect(calls.rpc[0].args.p_application_id).toBe("app_1");
    expect(calls.insert).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(body.decision.action).toBe("denied");
    expect(body.decision.reason).toBe("Income insufficient");
    expect(body.tenantId).toBeNull();
  });

  it("400s a denial without a reason", async () => {
    const { db, calls } = makeDb({ rental_applications: { oneRow: APP_ROW } });
    auth(db);
    expect((await postDecision("app_1", { action: "deny", reason: "  " })).status).toBe(400);
    expect(calls.rpc).toHaveLength(0);
  });

  it("approves through the RPC with validated lease inputs", async () => {
    const { db, calls } = makeDb({
      rental_applications: { oneRow: APP_ROW },
      rental_listings: { oneRow: LISTING_ROW },
    }, { data: RPC_OK_APPROVE });
    auth(db);
    const response = await postDecision("app_1", {
      action: "approve",
      lease: { startDate: "2026-11-01", monthlyRentCents: 160000, rentDueDay: 1 },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(calls.rpc).toHaveLength(1);
    const args = calls.rpc[0].args;
    expect(args.p_action).toBe("approve");
    expect(args.p_tenant_email).toBe("sam@example.com");
    expect(args.p_tenant_display_name).toBe("Sam Applicant");
    expect(args.p_lease_start_date).toBe("2026-11-01");
    expect(args.p_monthly_rent_cents).toBe(160000);
    expect(args.p_rent_due_day).toBe(1);
    expect(calls.insert).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(body.tenantId).toBe("rental_tenant_x");
    expect(body.leaseId).toBe("rental_lease_y");
    expect(body.decision.id).toBe("dec_1");
  });

  it("maps a raced P0001 (already decided) to 409", async () => {
    const { db } = makeDb({ rental_applications: { oneRow: APP_ROW } },
      { error: Object.assign(new Error("Only a pending application can be decided."), { code: "P0001" }) });
    auth(db);
    const response = await postDecision("app_1", { action: "deny", reason: "X" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/pending/);
  });

  it("maps a direct-call 42501 denial to 403", async () => {
    const { db } = makeDb({ rental_applications: { oneRow: APP_ROW } },
      { error: Object.assign(new Error("denied"), { code: "42501" }) });
    auth(db);
    expect((await postDecision("app_1", { action: "deny", reason: "X" })).status).toBe(403);
  });

  it("409s approval when a tenant already uses the applicant email", async () => {
    const { db } = makeDb({
      rental_applications: { oneRow: APP_ROW },
      rental_listings: { oneRow: LISTING_ROW },
    }, { error: Object.assign(new Error("dup"), { code: "23505" }) });
    auth(db);
    const response = await postDecision("app_1", { action: "approve", lease: { startDate: "2026-11-01" } });
    expect(response.status).toBe(409);
  });

  it("400s approval without a lease start date", async () => {
    const { db, calls } = makeDb({
      rental_applications: { oneRow: APP_ROW },
      rental_listings: { oneRow: LISTING_ROW },
    });
    auth(db);
    expect((await postDecision("app_1", { action: "approve", lease: {} })).status).toBe(400);
    expect(calls.rpc).toHaveLength(0);
  });

  it("defaults the rent to the listing's advertised rent", async () => {
    const { db, calls } = makeDb({
      rental_applications: { oneRow: APP_ROW },
      rental_listings: { oneRow: LISTING_ROW },
    }, { data: RPC_OK_APPROVE });
    auth(db);
    const response = await postDecision("app_1", { action: "approve", lease: { startDate: "2026-11-01" } });
    expect(response.status).toBe(200);
    expect(calls.rpc[0].args.p_monthly_rent_cents).toBe(160000);
    expect(calls.rpc[0].args.p_rent_due_day).toBe(1);
  });
});
