import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";
import { GET as getOne, PUT, DELETE as remove } from "./[id]/route";

// Chainable supabase stub with canned responses and call recording.
function makeDb(overrides = {}) {
  const calls = { insert: [], update: [], delete: [], eq: [], from: [] };
  const table = {
    select() { return table; },
    eq(column, value) { calls.eq.push([column, value]); return table; },
    order() { return table; },
    limit() { return table; },
    insert(payload) { calls.insert.push(payload); return table; },
    update(payload) { calls.update.push(payload); return table; },
    delete() { calls.delete.push(true); return table; },
    async maybeSingle() {
      if (calls.insert.length) return { data: overrides.insertedRow ?? null, error: null };
      return { data: overrides.oneRow ?? null, error: null };
    },
    async single() {
      if (calls.insert.length) return { data: overrides.insertedRow, error: null };
      return { data: overrides.updatedRow, error: null };
    },
    then(resolve) { resolve({ data: overrides.listRows || [], error: null }); },
  };
  const db = { from: vi.fn((name) => { calls.from.push(name); return table; }) };
  return { db, calls };
}

const UNIT = {
  id: "unit_1", property_id: "prop_1", label: "Unit A", status: "available",
  photo_bucket: "rental-photos", photo_object_path: "o/unit_1/x.jpg",
  bedrooms: 2, bathrooms: 1, square_feet: 900, available_at: "2026-11-01T00:00:00Z",
};

const LISTING_ROW = {
  id: "listing_1", unit_id: "unit_1", property_id: "prop_1", public_slug: "abcDEF123456",
  status: "draft", title: "Sunny 2-bed", description: "Nice", rent_cents: 160000,
  beds_display: "2", baths_display: "1", square_feet: 900, pet_policy: "Cats OK",
  available_at: "2026-11-01T00:00:00Z", photos: [], contact_email: null, contact_phone: null,
  listing_form_id: null, view_count: 0, published_at: null, updated_at: "2026-10-01T00:00:00Z",
};

function auth(db, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    supabaseClient: db, user: { id: "user_1" }, effectiveOwnerId: "owner_1",
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));
const put = (id, body) => PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const getById = (id) => getOne(new Request("https://t/"), { params: Promise.resolve({ id }) });
const removeById = (id) => remove(new Request("https://t/", { method: "DELETE" }), { params: Promise.resolve({ id }) });

describe("listings route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("lists the workspace's listings", async () => {
    const { db } = makeDb({ listRows: [LISTING_ROW] });
    auth(db);
    const response = await GET(new Request("https://t/?status=draft"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0].publicSlug).toBe("abcDEF123456");
  });

  it("403s listing creation for read-only members", async () => {
    const { db } = makeDb();
    auth(db, "read_only");
    const response = await post({ listing: { unitId: "unit_1", title: "T" } });
    expect(response.status).toBe(403);
  });

  it("400s on invalid input", async () => {
    const { db } = makeDb();
    auth(db);
    const response = await post({ listing: { unitId: "", title: "  ", rentCents: -5 } });
    expect(response.status).toBe(400);
  });

  it("404s when the unit belongs to another workspace", async () => {
    const { db } = makeDb({ oneRow: null });
    auth(db);
    const response = await post({ listing: { unitId: "unit_x", title: "T" } });
    expect(response.status).toBe(404);
  });

  it("creates a draft with a random public slug", async () => {
    const { db, calls } = makeDb({ oneRow: UNIT, insertedRow: { ...LISTING_ROW, public_slug: undefined } });
    auth(db);
    const response = await post({ listing: { unitId: "unit_1", title: "Sunny 2-bed", rentCents: 160000 } });
    const body = await response.json();
    expect(response.status).toBe(200);
    const inserted = calls.insert[0];
    expect(inserted.public_slug).toMatch(/^[a-zA-Z0-9]{12}$/);
    expect(inserted.status).toBe("draft");
    expect(inserted.owner_id).toBe("owner_1");
    expect(body.success).toBe(true);
  });

  it("snapshots the unit photo on publish", async () => {
    const { db, calls } = makeDb({ oneRow: UNIT, insertedRow: LISTING_ROW });
    auth(db);
    await post({ listing: { unitId: "unit_1", title: "Sunny 2-bed", status: "published" } });
    const inserted = calls.insert[0];
    expect(inserted.photos).toEqual([{ bucket: "rental-photos", path: "o/unit_1/x.jpg" }]);
    expect(inserted.published_at).toBeTruthy();
  });
});

describe("listing [id] route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("404s an unknown listing", async () => {
    const { db } = makeDb({ oneRow: null });
    auth(db);
    const response = await getById("nope");
    expect(response.status).toBe(404);
  });

  it("publishes a draft and stamps published_at", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LISTING_ROW, photos: [{ bucket: "rental-photos", path: "o/unit_1/x.jpg" }] }, updatedRow: LISTING_ROW });
    auth(db);
    const response = await put("listing_1", { listing: { status: "published" } });
    expect(response.status).toBe(200);
    expect(calls.update[0].status).toBe("published");
    expect(calls.update[0].published_at).toBeTruthy();
  });

  it("unpublishing clears published_at", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LISTING_ROW, status: "published" }, updatedRow: LISTING_ROW });
    auth(db);
    await put("listing_1", { listing: { status: "unpublished" } });
    expect(calls.update[0].published_at).toBeNull();
  });

  it("403s updates for read-only members", async () => {
    const { db } = makeDb({ oneRow: LISTING_ROW });
    auth(db, "read_only");
    const response = await put("listing_1", { listing: { title: "X" } });
    expect(response.status).toBe(403);
  });

  it("400s on an invalid status", async () => {
    const { db } = makeDb({ oneRow: LISTING_ROW });
    auth(db);
    const response = await put("listing_1", { listing: { status: "live" } });
    expect(response.status).toBe(400);
  });
});
