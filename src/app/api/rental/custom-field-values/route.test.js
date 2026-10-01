import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
// NOTE: isOwnerOrActiveCoOwner is intentionally NOT mocked here — the stub
// supabase client answers the workspace_members query, so these tests prove
// the real role matrix (primary owner / co_owner allowed; manager,
// bookkeeper, read_only blocked) end to end through the route.
import { GET, POST } from "./route";

// memberRole: null = primary owner (no workspace_members row),
// otherwise the active membership role.
function makeDb({ definitions = [], values = [], memberRole = null, recordExists = true, rpcError = null } = {}) {
  const calls = { rpc: [], tableOps: [] };
  const tableFor = (name) => {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      in(column, ids) { calls.tableOps.push(["in", name, column, ids]); return chain; },
      delete() { calls.tableOps.push(["delete", name]); return chain; },
      upsert(rows, options) { calls.tableOps.push(["upsert", name, rows, options]); return Promise.resolve({ error: null }); },
      async maybeSingle() {
        if (name === "workspace_members") {
          return { data: memberRole === null ? null : { role: memberRole }, error: null };
        }
        // Record-existence probe for the custom-field entity tables.
        return { data: recordExists ? { probe: 1 } : null, error: null };
      },
      then(resolve) {
        if (name === "rental_custom_fields") resolve({ data: definitions, error: null });
        else resolve({ data: values, error: null });
      },
    };
    return chain;
  };
  const db = {
    from: vi.fn((name) => tableFor(name)),
    rpc: vi.fn((fnName, args) => {
      calls.rpc.push([fnName, args]);
      return Promise.resolve(rpcError ? { error: rpcError } : { error: null });
    }),
  };
  return { db, calls };
}

const DEFS = [
  { id: "f_text", entity: "tenant", name: "Gate code", field_key: "gate_code", field_type: "text", is_required: false, picklist_options: null, sort_order: 0, updated_at: "t" },
  { id: "f_date", entity: "tenant", name: "Move-out inspection", field_key: "move_out_inspection", field_type: "date", is_required: true, picklist_options: null, sort_order: 1, updated_at: "t" },
  { id: "f_pick", entity: "tenant", name: "Parking spot", field_key: "parking_spot", field_type: "picklist", is_required: false, picklist_options: ["A1", "A2"], sort_order: 2, updated_at: "t" },
];

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
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

  it("rejects an unknown entity on GET and POST", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await GET(new Request("https://t/?entity=charge&recordId=x"))).status).toBe(400);
    const res = await post({ entity: "charge", recordId: "x", values: {} });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the record id does not exist in the entity table", async () => {
    const { db, calls } = makeDb({ definitions: DEFS, recordExists: false });
    authAs(db);
    const getRes = await GET(new Request("https://t/?entity=tenant&recordId=ghost"));
    expect(getRes.status).toBe(404);
    const postRes = await post({ entity: "tenant", recordId: "ghost", values: { f_date: "2026-10-15" } });
    expect(postRes.status).toBe(404);
    // Nothing is written when the record does not exist.
    expect(calls.rpc).toHaveLength(0);
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

  it("saves through the atomic RPC with type-cleaned values", async () => {
    const { db, calls } = makeDb({ definitions: DEFS });
    authAs(db);
    const res = await post({
      entity: "tenant", recordId: "tenant_1",
      values: { f_text: " 4821 ", f_date: "2026-10-15", f_pick: "A2" },
    });
    expect(res.status).toBe(200);
    expect(calls.rpc).toHaveLength(1);
    const [fnName, args] = calls.rpc[0];
    expect(fnName).toBe("save_rental_custom_field_values");
    expect(args.p_owner_id).toBe("owner_1");
    expect(args.p_record_id).toBe("tenant_1");
    const byField = Object.fromEntries(args.p_rows.map((row) => [row.field_id, row.value_text]));
    expect(byField).toEqual({ f_text: "4821", f_date: "2026-10-15", f_pick: "A2" });
    // The route must not issue its own delete/upsert anymore — the RPC owns
    // the write, which is what makes it atomic.
    expect(calls.tableOps.filter(([op]) => op === "delete" || op === "upsert")).toHaveLength(0);
  });

  it("passes cleared optional values as null rows (the RPC deletes them)", async () => {
    const { db, calls } = makeDb({ definitions: DEFS });
    authAs(db);
    // f_date is required so it must be supplied; f_text/f_pick omitted -> cleared.
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "2026-10-15" } });
    expect(res.status).toBe(200);
    const [, args] = calls.rpc[0];
    const byField = Object.fromEntries(args.p_rows.map((row) => [row.field_id, row.value_text]));
    expect(byField).toEqual({ f_text: null, f_date: "2026-10-15", f_pick: null });
  });

  it("returns 500 without issuing any partial write when the atomic save fails", async () => {
    const { db, calls } = makeDb({ definitions: DEFS, rpcError: { message: "connection lost" } });
    authAs(db);
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "2026-10-15" } });
    expect(res.status).toBe(500);
    // The single RPC was attempted and failed; no separate delete or upsert
    // was ever issued, so prior values remain untouched.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.tableOps.filter(([op]) => op === "delete" || op === "upsert")).toHaveLength(0);
  });

  it("rejects bad values without writing anything", async () => {
    const { db, calls } = makeDb({ definitions: DEFS });
    authAs(db);
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "not-a-date" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/date/i);
    expect(calls.rpc).toHaveLength(0);
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

  it.each([
    [null, 200, "primary owner"],
    ["co_owner", 200, "co-owner"],
    ["manager", 403, "manager"],
    ["bookkeeper", 403, "bookkeeper"],
    ["read_only", 403, "read-only"],
  ])("saving values as %s -> %s (%s)", async (memberRole, expectedStatus) => {
    const { db } = makeDb({ definitions: DEFS, memberRole });
    authAs(db);
    const res = await post({ entity: "tenant", recordId: "tenant_1", values: { f_date: "2026-10-15" } });
    expect(res.status).toBe(expectedStatus);
  });
});
