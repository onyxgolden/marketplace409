import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

function makeDb({ definitions = [], values = [] } = {}) {
  const calls = { upsert: [], delete: [], in: [] };
  const tableFor = (name) => {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      in(column, ids) { calls.in.push([name, column, ids]); return chain; },
      delete() { calls.delete.push(name); return chain; },
      upsert(rows, options) { calls.upsert.push([name, rows, options]); return Promise.resolve({ error: null }); },
      async maybeSingle() { return { data: null, error: null }; },
      then(resolve) {
        if (name === "rental_custom_fields") resolve({ data: definitions, error: null });
        else resolve({ data: values, error: null });
      },
    };
    return chain;
  };
  return { db: { from: vi.fn((name) => tableFor(name)) }, calls };
}

const DEFS = [
  { id: "f_text", entity: "tenant", name: "Gate code", field_key: "gate_code", field_type: "text", is_required: false, picklist_options: null, sort_order: 0, updated_at: "t" },
  { id: "f_date", entity: "tenant", name: "Move-out inspection", field_key: "move_out_inspection", field_type: "date", is_required: true, picklist_options: null, sort_order: 1, updated_at: "t" },
  { id: "f_pick", entity: "tenant", name: "Parking spot", field_key: "parking_spot", field_type: "picklist", is_required: false, picklist_options: ["A1", "A2"], sort_order: 2, updated_at: "t" },
];

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

describe("custom field values route", () => {
  it("requires entity and recordId", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await GET(new Request("https://t/"))).status).toBe(400);
  });

  it("returns definitions with their stored values keyed by field id", async () => {
    const { db } = makeDb({
      definitions: DEFS,
      values: [{ field_id: "f_text", value_text: "4821" }],
    });
    authAs(db);
    const res = await GET(new Request("https://t/?entity=tenant&recordId=tenant_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fields).toHaveLength(3);
    expect(body.fields[0]).toMatchObject({ id: "f_text", fieldKey: "gate_code" });
    expect(body.values).toEqual({ f_text: "4821" });
  });

  it("validates then upserts typed-cleaned values", async () => {
    const { db, calls } = makeDb({ definitions: DEFS });
    authAs(db);
    const res = await post({
      entity: "tenant", recordId: "tenant_1",
      values: { f_text: " 4821 ", f_date: "2026-10-15", f_pick: "A2" },
    });
    expect(res.status).toBe(200);
    expect(calls.upsert).toHaveLength(1);
    const [table, rows, options] = calls.upsert[0];
    expect(table).toBe("rental_custom_field_values");
    expect(options).toMatchObject({ onConflict: "owner_id,field_id,record_id" });
    const byField = Object.fromEntries(rows.map((row) => [row.field_id, row.value_text]));
    expect(byField).toEqual({ f_text: "4821", f_date: "2026-10-15", f_pick: "A2" });
    expect(rows[0]).toMatchObject({ owner_id: "owner_1", record_id: "tenant_1" });
  });

  it("clears optional values (deletes their rows) when omitted", async () => {
    const { db, calls } = makeDb({ definitions: DEFS });
    authAs(db);
    // f_date is required so it must be supplied; f_text/f_pick omitted -> cleared.
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "2026-10-15" } });
    expect(res.status).toBe(200);
    expect(calls.delete).toContain("rental_custom_field_values");
    const deletedIds = calls.in.find(([table]) => table === "rental_custom_field_values")[2];
    expect(deletedIds).toEqual(expect.arrayContaining(["f_text", "f_pick"]));
    expect(deletedIds).not.toContain("f_date");
  });

  it("rejects bad values without writing anything", async () => {
    const { db, calls } = makeDb({ definitions: DEFS });
    authAs(db);
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "not-a-date" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/date/i);
    expect(calls.upsert).toHaveLength(0);
    expect(calls.delete).toHaveLength(0);
  });

  it("enforces required fields even when the whole payload is empty", async () => {
    const { db } = makeDb({ definitions: DEFS });
    authAs(db);
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
  });

  it("rejects picklist values outside the choices", async () => {
    const { db } = makeDb({ definitions: DEFS });
    authAs(db);
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "2026-10-15", f_pick: "Z9" } });
    expect(res.status).toBe(400);
  });

  it("rejects values for unknown field ids", async () => {
    const { db } = makeDb({ definitions: DEFS });
    authAs(db);
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "2026-10-15", f_evil: "x" } });
    expect(res.status).toBe(400);
  });

  it("blocks read-only members from saving", async () => {
    const { db } = makeDb({ definitions: DEFS });
    authAs(db);
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: {} });
    expect(res.status).toBe(403);
  });
});
