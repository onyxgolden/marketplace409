import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";
import { GET as getOne, PUT, DELETE as remove } from "./[id]/route";
import { GET as getSchedule } from "./schedule/route";

// Chainable supabase stub with canned responses and call recording.
function makeDb(overrides = {}) {
  const calls = { insert: [], update: [], delete: [], eq: [], orderBy: [] };
  const table = {
    select() { return table; },
    eq(column, value) { calls.eq.push([column, value]); return table; },
    order(column, options) { calls.orderBy.push([column, options]); return table; },
    insert(payload) { calls.insert.push(payload); return table; },
    update(payload) { calls.update.push(payload); return table; },
    delete() { calls.delete.push(true); return table; },
    async maybeSingle() { return { data: overrides.oneRow ?? null, error: overrides.error || null }; },
    async single() {
      if (calls.insert.length) return { data: overrides.insertedRow, error: overrides.error || null };
      return { data: overrides.updatedRow, error: overrides.error || null };
    },
    then(resolve) { resolve({ data: overrides.listRows || [], error: overrides.error || null }); },
  };
  return { db: { from: vi.fn(() => table) }, calls };
}

const ROW = {
  id: "asset_1", property_id: "308-paula", description: "Refrigerator", category: "appliance",
  placed_in_service: "2026-07-15", cost_basis_cents: 120000, method: "straight_line",
  useful_life_months: 60, salvage_value_cents: 0, notes: null,
  created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z",
};

const NEW_ASSET = {
  propertyId: "308-paula", description: "Refrigerator", category: "appliance",
  placed_in_service: "2026-07-15", cost_basis_cents: 120000, method: "straight_line",
  useful_life_months: 60, salvage_value_cents: 0,
};

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));
const put = (body) => PUT(new Request("https://t/asset_1", { method: "PUT", body: JSON.stringify(body) }), { params: { id: "asset_1" } });
const getById = () => getOne(new Request("https://t/asset_1"), { params: { id: "asset_1" } });
const del = () => remove(new Request("https://t/asset_1", { method: "DELETE" }), { params: { id: "asset_1" } });

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceRole.mockResolvedValue("owner");
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

describe("depreciation assets collection route", () => {
  it("requires a propertyId on list", async () => {
    const { db } = makeDb();
    authAs(db);
    const res = await GET(new Request("https://t/"));
    expect(res.status).toBe(400);
  });

  it("lists assets scoped to owner and property", async () => {
    const { db, calls } = makeDb({ listRows: [ROW] });
    authAs(db);
    const res = await GET(new Request("https://t/?propertyId=308-paula"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({ id: "asset_1", propertyId: "308-paula", methodLabel: "Straight line" });
    expect(calls.eq).toContainEqual(["owner_id", "owner_1"]);
    expect(calls.eq).toContainEqual(["property_id", "308-paula"]);
  });

  it("creates a valid asset and normalizes a MACRS life to the preset", async () => {
    const { db, calls } = makeDb({ insertedRow: { ...ROW, method: "macrs_27_5", useful_life_months: 330 } });
    authAs(db);
    const res = await post({ ...NEW_ASSET, method: "macrs_27_5", useful_life_months: 12 });
    expect(res.status).toBe(201);
    // The 12-month life a caller supplied is normalized to the 330-month preset.
    expect(calls.insert[0].useful_life_months).toBe(330);
  });

  it("rejects invalid input with 400", async () => {
    const { db } = makeDb();
    authAs(db);
    const res = await post({ propertyId: "308-paula", description: "x" }); // no date, no cost
    expect(res.status).toBe(400);
  });

  it("refuses read-only members on create", async () => {
    const { db } = makeDb();
    authAs(db);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const res = await post(NEW_ASSET);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Read-only/);
  });

  it("passes auth failures through", async () => {
    const denied = new Response(null, { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ response: denied });
    expect(await GET(new Request("https://t/?propertyId=x"))).toBe(denied);
  });
});

describe("depreciation asset item route", () => {
  it("returns a single asset", async () => {
    const { db } = makeDb({ oneRow: ROW });
    authAs(db);
    const res = await getById();
    expect(res.status).toBe(200);
    expect((await res.json()).asset).toMatchObject({ id: "asset_1" });
  });

  it("404s on a missing asset", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    expect((await getById()).status).toBe(404);
  });

  it("updates with merged validation", async () => {
    const { db, calls } = makeDb({ oneRow: ROW, updatedRow: { ...ROW, description: "New fridge" } });
    authAs(db);
    const res = await put({ description: "New fridge" });
    expect(res.status).toBe(200);
    expect(calls.update[0].description).toBe("New fridge");
  });

  it("deletes and returns success", async () => {
    const { db, calls } = makeDb({ oneRow: ROW });
    authAs(db);
    const res = await del();
    expect(res.status).toBe(200);
    expect(calls.delete).toHaveLength(1);
  });

  it("refuses read-only members on update and delete", async () => {
    const { db } = makeDb({ oneRow: ROW });
    authAs(db);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    expect((await put({ description: "x" })).status).toBe(403);
    expect((await del()).status).toBe(403);
  });
});

describe("depreciation schedule report route", () => {
  it("computes the per-year report server-side from stored assets", async () => {
    const { db } = makeDb({ listRows: [ROW] });
    authAs(db);
    const res = await getSchedule(new Request("https://t/?propertyId=308-paula&year=2026"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Straight line $1200 / 60 months = $20/mo; placed 2026-07-15 → 6 months in 2026.
    expect(body.report.year).toBe(2026);
    expect(body.report.totals.depreciationTakenCents).toBe(12000);
    expect(body.report.assets[0]).toMatchObject({
      depreciationTakenCents: 12000,
      accumulatedCents: 12000,
      remainingBookValueCents: 108000,
    });
  });

  it("requires propertyId and year", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await getSchedule(new Request("https://t/?propertyId=x"))).status).toBe(400);
    expect((await getSchedule(new Request("https://t/?year=2026"))).status).toBe(400);
  });

  it("is readable by read-only members", async () => {
    const { db } = makeDb({ listRows: [ROW] });
    authAs(db);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const res = await getSchedule(new Request("https://t/?propertyId=308-paula&year=2026"));
    expect(res.status).toBe(200);
  });
});
