import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, PATCH } from "./route";

const baseCharge = {
  id: "c1", owner_id: "owner_1", lease_id: "l1", charge_type: "rent", amount_cents: 127500,
  paid_amount_cents: 50000, due_date: "2026-09-01", period: "2026-09",
  status: "due", notes: "September rent",
};

// The mock evaluates the chained write-time conditions against the CURRENT
// row — which a test may replace with a "concurrent" row simulating a payment
// applied (or a paid/void transition) between the route's initial read and its
// UPDATE. That is how the race tests prove the guards hold at write time.
function mockClient(charge = baseCharge, { concurrentCharge = null } = {}) {
  const state = { charge, patch: null, conditions: [] };
  const matchesOr = (current, expr) => expr.split(",").some((part) => {
    const [col, op, ...rest] = part.split(".");
    const val = rest.join(".");
    if (op === "eq") return String(current[col]) === val;
    if (op === "neq") return String(current[col]) !== val;
    return false;
  });
  const builder = {
    select() { return this; },
    eq(col, val) { state.conditions.push({ op: "eq", col, val }); return this; },
    neq(col, val) { state.conditions.push({ op: "neq", col, val }); return this; },
    lte(col, val) { state.conditions.push({ op: "lte", col, val }); return this; },
    or(expr) { state.conditions.push({ op: "or", expr }); return this; },
    async maybeSingle() { return { data: state.charge, error: null }; },
    update(patch) { state.patch = patch; return this; },
    async single() {
      const current = { ...(concurrentCharge || state.charge || {}) };
      const passes = state.conditions.every((c) => {
        if (c.op === "eq") return String(current[c.col]) === String(c.val);
        if (c.op === "neq") return String(current[c.col]) !== String(c.val);
        if (c.op === "lte") return Number(current[c.col]) <= Number(c.val);
        if (c.op === "or") return matchesOr(current, c.expr);
        return true;
      });
      if (!passes || !state.charge) return { data: null, error: { code: "PGRST116", message: "no rows" } };
      return { data: { ...current, ...(state.patch || {}) }, error: null };
    },
  };
  const client = { from: vi.fn(() => builder) };
  return { client, state };
}

function authAs(client) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
}

const get = (query = "") => GET(new Request(`https://t/${query}`));
const patch = (body) => PATCH(new Request("https://t/", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceRole.mockResolvedValue("owner");
  authAs(mockClient().client);
});

describe("tenant-charges GET", () => {
  it("requires a chargeId", async () => {
    expect((await get()).status).toBe(400);
    expect((await get("?chargeId=%20")).status).toBe(400);
  });

  it("returns the serialized charge", async () => {
    const res = await get("?chargeId=c1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      charge: { id: "c1", leaseId: "l1", chargeType: "rent", amountCents: 127500, paidCents: 50000, dueDate: "2026-09-01", status: "due", notes: "September rent" },
    });
  });

  it("404s when the charge belongs to another workspace (owner-scoped lookup)", async () => {
    authAs(mockClient(null).client);
    const res = await get("?chargeId=c1");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("passes auth failures through", async () => {
    const denied = new Response(null, { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ response: denied });
    expect(await get("?chargeId=c1")).toBe(denied);
  });
});

describe("tenant-charges PATCH", () => {
  it("blocks read-only members", async () => {
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    expect((await patch({ chargeId: "c1", notes: "x" })).status).toBe(403);
  });

  it("validates the request shape", async () => {
    expect((await patch({})).status).toBe(400);
    expect(((await patch({ chargeId: "c1", dueDate: "not-a-date" })).status)).toBe(400);
    expect((await patch({ chargeId: "c1", chargeType: "bogus" })).status).toBe(400);
    expect((await patch({ chargeId: "c1", amountCents: 0 })).status).toBe(400);
    expect((await patch({ chargeId: "c1", amountCents: -5 })).status).toBe(400);
    const nothing = await patch({ chargeId: "c1" });
    expect(nothing.status).toBe(400);
    expect((await nothing.json()).error).toMatch(/nothing to update/i);
  });

  it("404s across workspaces", async () => {
    authAs(mockClient(null).client);
    expect((await patch({ chargeId: "c1", notes: "x" })).status).toBe(404);
  });

  it("keeps voided charges immutable", async () => {
    authAs(mockClient({ ...baseCharge, status: "void" }).client);
    const res = await patch({ chargeId: "c1", notes: "x" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/voided/i);
  });

  it("keeps paid charges amount-final", async () => {
    authAs(mockClient({ ...baseCharge, status: "paid", amount_cents: 50000, paid_amount_cents: 50000 }).client);
    const res = await patch({ chargeId: "c1", amountCents: 60000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/final/i);
  });

  it("never drops the invoiced amount below applied payments", async () => {
    const res = await patch({ chargeId: "c1", amountCents: 49999 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already applied/i);
  });

  it("updates due date, charge type, and notes", async () => {
    const { client, state } = mockClient();
    authAs(client);
    const res = await patch({ chargeId: "c1", dueDate: "2026-10-01", chargeType: "late_fee", notes: "Late fee for September" });
    expect(res.status).toBe(200);
    expect(state.patch).toMatchObject({ due_date: "2026-10-01", charge_type: "late_fee", notes: "Late fee for September" });
    expect(state.patch.updated_at).toBeDefined();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.charge.dueDate).toBe("2026-10-01");
  });

  it("settles the charge when the amount is lowered onto the paid balance", async () => {
    const { client, state } = mockClient();
    authAs(client);
    const res = await patch({ chargeId: "c1", amountCents: 50000 });
    expect(res.status).toBe(200);
    expect(state.patch).toMatchObject({ amount_cents: 50000, status: "paid" });
  });

  it("allows raising the amount on a partially paid charge", async () => {
    const { client, state } = mockClient();
    authAs(client);
    const res = await patch({ chargeId: "c1", amountCents: 130000 });
    expect(res.status).toBe(200);
    expect(state.patch.amount_cents).toBe(130000);
    expect(state.patch.status).toBeUndefined();
  });

  it("passes auth failures through", async () => {
    const denied = new Response(null, { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ response: denied });
    expect(await patch({ chargeId: "c1", notes: "x" })).toBe(denied);
  });
});

describe("tenant-charges PATCH concurrent-payment race", () => {
  it("refuses to lower the amount below payments applied after the read", async () => {
    // The read sees paid 50,000 and the editor settles the invoice at 50,000 —
    // but a 10,000 payment lands before the write (paid is now 60,000).
    const { client } = mockClient(baseCharge, {
      concurrentCharge: { ...baseCharge, paid_amount_cents: 60000, status: "partially_paid" },
    });
    authAs(client);
    const res = await patch({ chargeId: "c1", amountCents: 50000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed while you were editing/i);
  });

  it("refuses to raise the amount on a charge that became paid after the read", async () => {
    const { client } = mockClient(baseCharge, {
      concurrentCharge: { ...baseCharge, paid_amount_cents: 127500, status: "paid" },
    });
    authAs(client);
    const res = await patch({ chargeId: "c1", amountCents: 130000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed while you were editing/i);
  });

  it("refuses any edit on a charge that was voided after the read", async () => {
    const { client } = mockClient(baseCharge, {
      concurrentCharge: { ...baseCharge, status: "void" },
    });
    authAs(client);
    const res = await patch({ chargeId: "c1", notes: "late edit" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed while you were editing/i);
  });

  it("still succeeds when a concurrent payment does not break the guards", async () => {
    // Paid moves 50,000 -> 60,000, but the raised amount (130,000) still
    // covers it and the charge is not paid/void — the write must go through.
    const { client, state } = mockClient(baseCharge, {
      concurrentCharge: { ...baseCharge, paid_amount_cents: 60000, status: "partially_paid" },
    });
    authAs(client);
    const res = await patch({ chargeId: "c1", amountCents: 130000 });
    expect(res.status).toBe(200);
    expect(state.patch.amount_cents).toBe(130000);
    expect((await res.json()).charge.paidCents).toBe(60000);
  });
});
