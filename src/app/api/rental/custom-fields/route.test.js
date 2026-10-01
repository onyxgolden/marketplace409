import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
// NOTE: isOwnerOrActiveCoOwner is intentionally NOT mocked — the stub
// supabase client answers the workspace_members query, so these tests prove
// the real role matrix (primary owner / co_owner allowed; manager,
// bookkeeper, read_only blocked) end to end through the routes.
import { GET, POST } from "./route";
import { GET as getOne, PUT, DELETE as remove } from "./[id]/route";

// Chainable supabase stub with canned responses and call recording.
// memberRole: null = primary owner (no workspace_members row), otherwise the
// active membership role.
function makeDb(overrides = {}) {
  const calls = { insert: [], update: [], delete: [], eq: [], in: [] };
  const memberTable = {
    select() { return memberTable; },
    eq() { return memberTable; },
    async maybeSingle() {
      return {
        data: overrides.memberRole === undefined || overrides.memberRole === null
          ? null
          : { role: overrides.memberRole },
        error: null,
      };
    },
  };
  const table = {
    select() { return table; },
    eq(column, value) { calls.eq.push([column, value]); return table; },
    order() { return table; },
    in(column, values) { calls.in.push([column, values]); return table; },
    insert(payload) { calls.insert.push(payload); return table; },
    update(payload) { calls.update.push(payload); return table; },
    delete() { calls.delete.push(true); return table; },
    async maybeSingle() { return { data: overrides.oneRow ?? null, error: null }; },
    async single() {
      if (overrides.insertError) return { data: null, error: overrides.insertError };
      return { data: overrides.insertedRow ?? overrides.updatedRow, error: null };
    },
    then(resolve) { resolve({ data: overrides.listRows || [], error: null }); },
  };
  return {
    db: { from: vi.fn((name) => (name === "workspace_members" ? memberTable : table)) },
    calls,
  };
}

const ROW = {
  id: "f_1", entity: "tenant", name: "Gate code", field_key: "gate_code",
  field_type: "text", is_required: false, picklist_options: null,
  sort_order: 0, updated_at: "2026-10-01T12:00:00Z",
};

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));
const put = (body) => PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify(body) }), { params: { id: "f_1" } });

beforeEach(() => {
  vi.clearAllMocks();
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

describe("custom fields collection route", () => {
  it("lists field definitions with the client shape", async () => {
    const { db } = makeDb({ listRows: [ROW] });
    authAs(db);
    const res = await GET(new Request("https://t/?entity=tenant"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0]).toMatchObject({
      id: "f_1", entity: "tenant", name: "Gate code", fieldKey: "gate_code",
      fieldType: "text", isRequired: false,
    });
  });

  it("creates a field with the validated, slug-keyed shape", async () => {
    const { db, calls } = makeDb({ insertedRow: ROW });
    authAs(db);
    const res = await post({ name: "Gate code", entity: "tenant", fieldType: "text" });
    expect(res.status).toBe(201);
    const payload = calls.insert[0];
    expect(payload).toMatchObject({
      owner_id: "owner_1", entity: "tenant", name: "Gate code",
      field_key: "gate_code", field_type: "text", created_by: "user_1",
    });
    const body = await res.json();
    expect(body.field).toMatchObject({ fieldKey: "gate_code" });
  });

  it("rejects invalid definitions with a 400", async () => {
    const { db } = makeDb();
    authAs(db);
    const res = await post({ name: "", entity: "tenant", fieldType: "text" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("maps duplicate names to a 409", async () => {
    const { db } = makeDb({ insertError: { code: "23505", message: "duplicate key" } });
    authAs(db);
    const res = await post({ name: "Gate code", entity: "tenant", fieldType: "text" });
    expect(res.status).toBe(409);
  });

  it.each([
    [null, 201, "primary owner"],
    ["co_owner", 201, "co-owner"],
    ["manager", 403, "manager"],
    ["bookkeeper", 403, "bookkeeper"],
    ["read_only", 403, "read-only"],
  ])("creating as %s -> %s (%s)", async (memberRole, expectedStatus) => {
    const { db } = makeDb({ insertedRow: ROW, memberRole });
    authAs(db);
    const res = await post({ name: "Gate code", entity: "tenant", fieldType: "text" });
    expect(res.status).toBe(expectedStatus);
  });

  it("passes auth failures through", async () => {
    const denied = new Response(null, { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ response: denied });
    expect(await GET(new Request("https://t/"))).toBe(denied);
  });
});

describe("custom field single route", () => {
  it("updates the definition and regenerates the key", async () => {
    const { db, calls } = makeDb({ oneRow: ROW, updatedRow: { ...ROW, name: "Building gate code", field_key: "building_gate_code" } });
    authAs(db);
    const res = await put({ name: "Building gate code", entity: "tenant", fieldType: "text" });
    expect(res.status).toBe(200);
    expect(calls.update[0]).toMatchObject({ name: "Building gate code", field_key: "building_gate_code" });
  });

  it("404s on unknown ids", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    expect((await getOne(new Request("https://t/"), { params: { id: "nope" } })).status).toBe(404);
    expect((await put({ name: "X", entity: "tenant", fieldType: "text" })).status).toBe(404);
    expect((await remove(new Request("https://t/"), { params: { id: "nope" } })).status).toBe(404);
  });

  it.each([
    [null, 200, "primary owner"],
    ["co_owner", 200, "co-owner"],
    ["manager", 403, "manager"],
    ["bookkeeper", 403, "bookkeeper"],
    ["read_only", 403, "read-only"],
  ])("update as %s -> %s (%s)", async (memberRole, expectedStatus) => {
    const { db } = makeDb({ oneRow: ROW, updatedRow: ROW, memberRole });
    authAs(db);
    expect((await put({ name: "X", entity: "tenant", fieldType: "text" })).status).toBe(expectedStatus);
  });

  it.each([
    [null, 200, "primary owner"],
    ["co_owner", 200, "co-owner"],
    ["manager", 403, "manager"],
    ["bookkeeper", 403, "bookkeeper"],
    ["read_only", 403, "read-only"],
  ])("delete as %s -> %s (%s)", async (memberRole, expectedStatus) => {
    const { db } = makeDb({ oneRow: ROW, memberRole });
    authAs(db);
    expect((await remove(new Request("https://t/"), { params: { id: "f_1" } })).status).toBe(expectedStatus);
  });
});
