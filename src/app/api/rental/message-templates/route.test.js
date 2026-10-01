import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
vi.mock("@/domains/rental-messaging/messageTemplateContext", () => ({ resolveWorkOrderTemplateContext: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { resolveWorkOrderTemplateContext } from "@/domains/rental-messaging/messageTemplateContext";
import { GET, POST } from "./route";
import { GET as getOne, PUT, DELETE as remove } from "./[id]/route";
import { POST as render } from "./render/route";

// Chainable supabase stub with canned responses and call recording.
function makeDb(overrides = {}) {
  const calls = { upsert: [], insert: [], update: [], delete: [], eq: [] };
  const table = {
    select() { return table; },
    eq(column, value) { calls.eq.push([column, value]); return table; },
    order() { return table; },
    upsert(rows, options) { calls.upsert.push([rows, options]); return Promise.resolve({ error: overrides.upsertError || null }); },
    insert(payload) { calls.insert.push(payload); return table; },
    update(payload) { calls.update.push(payload); return table; },
    delete() { calls.delete.push(true); return table; },
    async maybeSingle() { return { data: overrides.oneRow ?? null, error: null }; },
    async single() {
      if (calls.insert.length) return { data: overrides.insertedRow, error: null };
      return { data: overrides.updatedRow, error: null };
    },
    then(resolve) { resolve({ data: overrides.listRows || [], error: null }); },
  };
  return { db: { from: vi.fn(() => table) }, calls };
}

const ROW = {
  id: "tpl_1", system_key: null, is_system: false, name: "Custom nudge",
  kind: "text", audience: "tenant", subject: null, body: "Hi {{tenant_name}}",
  updated_at: "2026-09-30T12:00:00Z",
};
const SYSTEM_ROW = { ...ROW, id: "sys_1", system_key: "rent_reminder_tenant_text", is_system: true, name: "Rent reminder" };

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceRole.mockResolvedValue("owner");
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

describe("message templates collection route", () => {
  it("seeds the system catalog on list, then returns mapped templates", async () => {
    const { db, calls } = makeDb({ listRows: [SYSTEM_ROW, ROW] });
    authAs(db);
    const res = await GET(new Request("https://t/"));
    expect(res.status).toBe(200);
    expect(calls.upsert).toHaveLength(1);
    expect(calls.upsert[0][1]).toMatchObject({ onConflict: "owner_id,system_key", ignoreDuplicates: true });
    const body = await res.json();
    expect(body.templates).toHaveLength(2);
    expect(body.templates[0]).toMatchObject({ id: "sys_1", systemKey: "rent_reminder_tenant_text", isSystem: true });
    expect(body.templates[1]).toMatchObject({ id: "tpl_1", systemKey: null, isSystem: false, updatedAt: "2026-09-30T12:00:00Z" });
  });

  it("forwards kind/audience filters to the query", async () => {
    const { db, calls } = makeDb({ listRows: [] });
    authAs(db);
    await GET(new Request("https://t/?kind=text&audience=tenant"));
    expect(calls.eq).toContainEqual(["owner_id", "owner_1"]);
    expect(calls.eq).toContainEqual(["kind", "text"]);
    expect(calls.eq).toContainEqual(["audience", "tenant"]);
  });

  it("passes auth failures through", async () => {
    const denied = new Response(null, { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ response: denied });
    expect(await GET(new Request("https://t/"))).toBe(denied);
  });

  it("refuses read-only members on create", async () => {
    const { db } = makeDb();
    authAs(db);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const res = await post({ name: "x", kind: "text", audience: "tenant", body: "Hi" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Read-only/);
  });

  it("validates input before touching the database", async () => {
    const { db } = makeDb();
    authAs(db);
    const res = await post({ name: "", kind: "text", audience: "tenant", body: "Hi" });
    expect(res.status).toBe(400);
    expect(db.from).not.toHaveBeenCalledWith("rental_message_templates");
  });

  it("creates a custom template, never a system one", async () => {
    const { db, calls } = makeDb({ insertedRow: ROW });
    authAs(db);
    const res = await post({ name: "Custom nudge", kind: "text", audience: "tenant", subject: "ignored", body: "Hi {{tenant_name}}", is_system: true });
    expect(res.status).toBe(201);
    expect(calls.insert).toHaveLength(1);
    expect(calls.insert[0]).toMatchObject({
      owner_id: "owner_1", is_system: false, created_by: "user_1",
      name: "Custom nudge", kind: "text", audience: "tenant",
      subject: null, // text templates store no subject
      body: "Hi {{tenant_name}}",
    });
    expect((await res.json()).template).toMatchObject({ id: "tpl_1", isSystem: false });
  });

  it("duplicates a system template into an owned custom copy", async () => {
    const { db, calls } = makeDb({ oneRow: SYSTEM_ROW, insertedRow: { ...SYSTEM_ROW, id: "tpl_copy", is_system: false, system_key: null } });
    authAs(db);
    const res = await post({ duplicateFrom: "sys_1" });
    expect(res.status).toBe(201);
    expect(calls.insert[0]).toMatchObject({
      is_system: false, name: "Rent reminder (copy)",
      kind: SYSTEM_ROW.kind, audience: SYSTEM_ROW.audience, body: SYSTEM_ROW.body,
    });
  });

  it("404s when duplicating a template that does not exist", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    expect((await post({ duplicateFrom: "nope" })).status).toBe(404);
  });
});

describe("message template item route", () => {
  const getReq = (id) => ({ params: Promise.resolve({ id }) });

  it("reads one template", async () => {
    const { db } = makeDb({ oneRow: ROW });
    authAs(db);
    const res = await getOne(new Request("https://t/"), getReq("tpl_1"));
    expect(res.status).toBe(200);
    expect((await res.json()).template).toMatchObject({ id: "tpl_1", name: "Custom nudge" });
  });

  it("404s on a missing template", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    expect((await getOne(new Request("https://t/"), getReq("nope"))).status).toBe(404);
  });

  it("refuses read-only members on update and delete", async () => {
    const { db } = makeDb({ oneRow: ROW });
    authAs(db);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    expect((await PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify({}) }), getReq("tpl_1"))).status).toBe(403);
    expect((await remove(new Request("https://t/", { method: "DELETE" }), getReq("tpl_1"))).status).toBe(403);
  });

  it("updates a custom template", async () => {
    const { db, calls } = makeDb({ oneRow: ROW, updatedRow: { ...ROW, name: "Renamed" } });
    authAs(db);
    const res = await PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify({ name: "Renamed", kind: "text", audience: "tenant", body: "Hi!" }) }), getReq("tpl_1"));
    expect(res.status).toBe(200);
    expect(calls.update[0]).toMatchObject({ name: "Renamed", body: "Hi!" });
    expect(calls.update[0].updated_at).toBeTruthy();
    expect((await res.json()).template.name).toBe("Renamed");
  });

  it("blocks edits to system templates with the duplicate pointer", async () => {
    const { db } = makeDb({ oneRow: SYSTEM_ROW });
    authAs(db);
    const res = await PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify({ name: "x", kind: "text", audience: "tenant", body: "y" }) }), getReq("sys_1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/duplicate/);
  });

  it("deletes a custom template but never a system one", async () => {
    const { db, calls } = makeDb({ oneRow: ROW });
    authAs(db);
    const res = await remove(new Request("https://t/", { method: "DELETE" }), getReq("tpl_1"));
    expect(res.status).toBe(200);
    expect(calls.delete).toHaveLength(1);
    expect((await res.json()).deletedId).toBe("tpl_1");

    const sys = makeDb({ oneRow: SYSTEM_ROW });
    authAs(sys.db);
    const blocked = await remove(new Request("https://t/", { method: "DELETE" }), getReq("sys_1"));
    expect(blocked.status).toBe(403);
    expect(sys.calls.delete).toHaveLength(0);
  });
});

describe("message template render route", () => {
  const renderPost = (body) => render(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

  it("requires a templateId", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await renderPost({})).status).toBe(400);
  });

  it("404s on an unknown template", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    expect((await renderPost({ templateId: "nope" })).status).toBe(404);
  });

  it("renders body and subject through the shared server-side renderer", async () => {
    const { db } = makeDb({ oneRow: { id: "sys_1", subject: "Hi {{tenant_name}}", body: "Owe {{balance_due}} {{mystery}}" } });
    authAs(db);
    resolveWorkOrderTemplateContext.mockResolvedValue({ tenant_name: "Eric Carrillo" });
    const res = await renderPost({ templateId: "sys_1", workOrderId: "wo_1" });
    expect(res.status).toBe(200);
    expect(resolveWorkOrderTemplateContext).toHaveBeenCalledWith({
      supabaseClient: db, ownerId: "owner_1", workOrderId: "wo_1",
    });
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      subject: "Hi Eric Carrillo",
      body: "Owe  {{mystery}}",
      missingFields: ["balance_due"],
      unknownFields: ["mystery"],
    });
  });

  it("renders without context when no workOrderId is given", async () => {
    const { db } = makeDb({ oneRow: { id: "tpl_1", subject: null, body: "Hi {{tenant_name}}" } });
    authAs(db);
    const res = await renderPost({ templateId: "tpl_1" });
    expect(res.status).toBe(200);
    expect(resolveWorkOrderTemplateContext).not.toHaveBeenCalled();
    expect((await res.json()).body).toBe("Hi ");
  });
});
