import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
vi.mock("@/domains/rental-forms/noticeContext", () => ({ resolveNoticeContext: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { resolveNoticeContext } from "@/domains/rental-forms/noticeContext";
import { GET, POST } from "./route";
import { GET as getOne, PUT, DELETE as remove } from "./[id]/route";
import { POST as render } from "./render/route";
import { GET as listNotices, POST as logNotice } from "../notices/route";

function makeDb(overrides = {}) {
  const calls = { upsert: [], insert: [], update: [], delete: [], eq: [], limit: [] };
  const table = {
    select() { return table; },
    eq(column, value) { calls.eq.push([column, value]); return table; },
    order() { return table; },
    limit(n) { calls.limit.push(n); return table; },
    upsert(rows, options) { calls.upsert.push([rows, options]); return Promise.resolve({ error: overrides.upsertError || null }); },
    insert(payload) { calls.insert.push(payload); return table; },
    update(payload) { calls.update.push(payload); return table; },
    delete() { calls.delete.push(true); return table; },
    async maybeSingle() { return { data: overrides.oneRow ?? null, error: null }; },
    async single() { return { data: overrides.insertedRow ?? overrides.updatedRow, error: null }; },
    then(resolve) { resolve({ data: overrides.listRows || [], error: null }); },
  };
  return { db: { from: vi.fn(() => table) }, calls };
}

const ROW = {
  id: "form_1", system_key: null, is_system: false, name: "Garage rules",
  kind: "form", body: "Hello {{tenant.name}}", updated_at: "2026-10-01T12:00:00Z",
};
const SYSTEM_ROW = { ...ROW, id: "sys_1", system_key: "pay_or_quit_notice", is_system: true, name: "Pay or quit notice", kind: "notice" };

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));
const putOne = (body) => PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify(body) }), { params: { id: "form_1" } });

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceRole.mockResolvedValue("owner");
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

describe("custom forms collection route", () => {
  it("seeds the system catalog on list, then returns mapped forms", async () => {
    const { db, calls } = makeDb({ listRows: [SYSTEM_ROW, ROW] });
    authAs(db);
    const res = await GET(new Request("https://t/"));
    expect(res.status).toBe(200);
    expect(calls.upsert).toHaveLength(1);
    expect(calls.upsert[0][1]).toMatchObject({ onConflict: "owner_id,system_key", ignoreDuplicates: true });
    const body = await res.json();
    expect(body.forms).toHaveLength(2);
    expect(body.forms[0]).toMatchObject({ id: "sys_1", systemKey: "pay_or_quit_notice", isSystem: true });
    expect(body.forms[1]).toMatchObject({ id: "form_1", systemKey: null, isSystem: false });
  });

  it("forwards the kind filter to the query", async () => {
    const { db, calls } = makeDb({ listRows: [] });
    authAs(db);
    await GET(new Request("https://t/?kind=notice"));
    expect(calls.eq).toContainEqual(["kind", "notice"]);
  });

  it("creates a custom form and duplicates a system form", async () => {
    const { db, calls } = makeDb({ insertedRow: ROW, oneRow: SYSTEM_ROW });
    authAs(db);
    const created = await post({ name: "Garage rules", kind: "form", body: "Hello {{tenant.name}}" });
    expect(created.status).toBe(201);
    expect(calls.insert[0]).toMatchObject({ owner_id: "owner_1", is_system: false, name: "Garage rules" });

    const duplicated = await post({ duplicateFrom: "sys_1" });
    expect(duplicated.status).toBe(201);
    expect(calls.insert[1]).toMatchObject({ name: "Pay or quit notice (copy)", kind: "notice" });
  });

  it("blocks read-only members from creating", async () => {
    const { db } = makeDb();
    authAs(db);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    expect((await post({ name: "X", kind: "form", body: "Y" })).status).toBe(403);
  });
});

describe("custom form single route", () => {
  it("protects system forms from edit and delete", async () => {
    const { db } = makeDb({ oneRow: SYSTEM_ROW });
    authAs(db);
    const edited = await PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify({ name: "X", kind: "notice", body: "Y" }) }), { params: { id: "sys_1" } });
    expect(edited.status).toBe(403);
    expect((await remove(new Request("https://t/"), { params: { id: "sys_1" } })).status).toBe(403);
  });

  it("edits and deletes custom forms", async () => {
    const { db, calls } = makeDb({ oneRow: ROW, updatedRow: ROW });
    authAs(db);
    expect((await putOne({ name: "Garage rules v2", kind: "form", body: "Hi" })).status).toBe(200);
    expect(calls.update[0]).toMatchObject({ name: "Garage rules v2" });
    expect((await remove(new Request("https://t/"), { params: { id: "form_1" } })).status).toBe(200);
    expect(calls.delete).toHaveLength(1);
  });

  it("404s on unknown ids and 403s read-only writes", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    expect((await getOne(new Request("https://t/"), { params: { id: "nope" } })).status).toBe(404);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    expect((await putOne({ name: "X", kind: "form", body: "Y" })).status).toBe(403);
  });
});

describe("notice render route", () => {
  it("renders a stored form against the resolved context", async () => {
    const { db } = makeDb({ oneRow: { body: "Hi {{tenant.name}}, code {{custom.gate_code}}." } });
    authAs(db);
    resolveNoticeContext.mockResolvedValue({
      tenant: { name: "Eric Carrillo" }, custom: { gate_code: "4821" },
    });
    const res = await render(new Request("https://t/", {
      method: "POST", body: JSON.stringify({ formId: "form_1", tenantId: "tenant_1" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Hi Eric Carrillo, code 4821.");
    expect(body.missing).toEqual([]);
    expect(body.unknown).toEqual([]);
    expect(resolveNoticeContext).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "owner_1", tenantId: "tenant_1" }),
    );
  });

  it("renders an ad-hoc body and reports missing placeholders", async () => {
    const { db } = makeDb();
    authAs(db);
    resolveNoticeContext.mockResolvedValue({ tenant: { name: null } });
    const res = await render(new Request("https://t/", {
      method: "POST", body: JSON.stringify({ body: "Hi {{tenant.name}}", tenantId: "tenant_1" }),
    }));
    const body = await res.json();
    expect(body.text).toBe("Hi ");
    expect(body.missing).toEqual(["tenant.name"]);
  });

  it("requires a tenant and a form or body", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await render(new Request("https://t/", { method: "POST", body: JSON.stringify({}) }))).status).toBe(400);
    expect((await render(new Request("https://t/", { method: "POST", body: JSON.stringify({ tenantId: "t" }) }))).status).toBe(400);
  });

  it("404s on unknown form ids", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    const res = await render(new Request("https://t/", {
      method: "POST", body: JSON.stringify({ formId: "nope", tenantId: "tenant_1" }),
    }));
    expect(res.status).toBe(404);
  });
});

describe("notice log route", () => {
  it("lists logged notices newest-first and filters by tenant", async () => {
    const rows = [
      { id: "n1", tenant_id: "t1", lease_id: null, form_id: "f1", form_name: "Pay or quit", rendered_body: "R", created_at: "t" },
    ];
    const { db, calls } = makeDb({ listRows: rows });
    authAs(db);
    const res = await listNotices(new Request("https://t/?tenantId=t1"));
    expect(res.status).toBe(200);
    expect(calls.eq).toContainEqual(["tenant_id", "t1"]);
    expect(calls.limit).toEqual([200]);
    const body = await res.json();
    expect(body.notices).toHaveLength(1);
    expect(body.notices[0]).toMatchObject({ id: "n1", tenantId: "t1", formName: "Pay or quit", renderedBody: "R" });
  });

  it("logs a generated notice with its rendered snapshot", async () => {
    const inserted = { id: "n2", tenant_id: "t1", lease_id: "l1", form_id: "f1", form_name: "Pay or quit", rendered_body: "Hi Eric", created_at: "t" };
    const { db, calls } = makeDb({ insertedRow: inserted });
    authAs(db);
    const res = await logNotice(new Request("https://t/", {
      method: "POST",
      body: JSON.stringify({ tenantId: "t1", leaseId: "l1", formId: "f1", formName: "Pay or quit", renderedBody: "Hi Eric" }),
    }));
    expect(res.status).toBe(201);
    expect(calls.insert[0]).toMatchObject({
      owner_id: "owner_1", tenant_id: "t1", lease_id: "l1", form_id: "f1",
      form_name: "Pay or quit", rendered_body: "Hi Eric", created_by: "user_1",
    });
    expect((await res.json()).notice).toMatchObject({ id: "n2" });
  });

  it("validates required log fields and blocks read-only members", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await logNotice(new Request("https://t/", { method: "POST", body: JSON.stringify({}) }))).status).toBe(400);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    expect((await logNotice(new Request("https://t/", {
      method: "POST", body: JSON.stringify({ tenantId: "t1", formName: "X", renderedBody: "Y" }),
    }))).status).toBe(403);
  });
});
