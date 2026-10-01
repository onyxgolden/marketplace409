import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";
import { GET as getOne, PUT, DELETE as remove } from "./[id]/route";

function makeDb(overrides = {}) {
  const calls = { insert: [], update: [], eq: [], from: [] };
  const table = {
    select() { return table; },
    eq(column, value) { calls.eq.push([column, value]); return table; },
    order() { return table; },
    limit() { return table; },
    insert(payload) { calls.insert.push(payload); return table; },
    update(payload) { calls.update.push(payload); return table; },
    delete() { calls.delete = true; return table; },
    async maybeSingle() { return { data: overrides.oneRow ?? null, error: null }; },
    async single() {
      if (calls.insert.length) return { data: overrides.insertedRow, error: null };
      return { data: overrides.updatedRow, error: null };
    },
    then(resolve) { resolve({ data: overrides.listRows || [], error: null }); },
  };
  const db = { from: vi.fn((name) => { calls.from.push(name); return table; }) };
  return { db, calls };
}

const FORM_ROW = {
  id: "form_1", name: "Standard rental application", is_default: true,
  sections: { personal_info: true, residence_history: true, employment: true, references: true },
  custom_questions: [], fee_amount_cents: 0, consent_text: null, updated_at: "2026-10-01T00:00:00Z",
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

describe("application forms route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("seeds the default form on first list", async () => {
    const { db, calls } = makeDb({ listRows: [] });
    auth(db);
    const response = await GET(new Request("https://t/"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // Seed check found no default form → one insert ran before the list read.
    expect(calls.insert).toHaveLength(1);
    expect(calls.insert[0].is_default).toBe(true);
    expect(calls.insert[0].name).toBe("Standard rental application");
  });

  it("403s creation for read-only members", async () => {
    const { db } = makeDb();
    auth(db, "read_only");
    const response = await post({ form: { name: "Custom" } });
    expect(response.status).toBe(403);
  });

  it("400s on invalid form input", async () => {
    const { db } = makeDb();
    auth(db);
    const response = await post({ form: { name: "", feeAmountCents: -10 } });
    expect(response.status).toBe(400);
  });

  it("creates a form with custom questions", async () => {
    const { db, calls } = makeDb({ listRows: [FORM_ROW], insertedRow: { ...FORM_ROW, id: "form_2", name: "Pet addendum", is_default: false } });
    auth(db);
    const response = await post({
      form: {
        name: "Pet addendum",
        customQuestions: [{ key: "pets", label: "Pets?", type: "select", required: true, options: ["Yes", "No"] }],
        feeAmountCents: 2500,
      },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(calls.insert[0].custom_questions).toHaveLength(1);
    expect(calls.insert[0].fee_amount_cents).toBe(2500);
    expect(body.form.name).toBe("Pet addendum");
  });
});

describe("application form [id] route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("404s an unknown form", async () => {
    const { db } = makeDb({ oneRow: null });
    auth(db);
    expect((await getById("nope")).status).toBe(404);
  });

  it("keeps the default form's name on update but saves sections", async () => {
    const { db, calls } = makeDb({ oneRow: FORM_ROW, updatedRow: FORM_ROW });
    auth(db);
    const response = await put("form_1", { form: { name: "Renamed", sections: { personal_info: true, residence_history: false, employment: true, references: true }, feeAmountCents: 1000 } });
    expect(response.status).toBe(200);
    expect(calls.update[0].name).toBe("Standard rental application");
    expect(calls.update[0].sections.residence_history).toBe(false);
    expect(calls.update[0].fee_amount_cents).toBe(1000);
  });

  it("409s deleting the default form", async () => {
    const { db } = makeDb({ oneRow: FORM_ROW });
    auth(db);
    expect((await removeById("form_1")).status).toBe(409);
  });

  it("409s deleting a form attached to a listing", async () => {
    const { db } = makeDb({ oneRow: { ...FORM_ROW, id: "form_2", is_default: false, name: "Pet addendum" }, listRows: [{ id: "listing_1" }] });
    auth(db);
    expect((await removeById("form_2")).status).toBe(409);
  });
});
