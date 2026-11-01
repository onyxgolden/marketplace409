import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST } from "./route";

// Controls-sweep follow-up G21 (O-11): application reopen + delete.
function makeDb({ application, auditError = null, deleted = [] } = {}) {
  const chainFor = (table) => {
    const chain = {
      select() { return chain; }, eq() { return chain; },
      update() { return chain; },
      insert() {
        if (auditError) return { then: (resolve) => resolve({ data: null, error: auditError }) };
        return chain;
      },
      delete() { deleted.push(table); return chain; },
      async maybeSingle() { return { data: application, error: null }; },
      async single() {
        if (table === "rental_applications") return { data: { id: application.id, status: "pending" }, error: null };
        return { data: { id: "dec_1" }, error: null };
      },
      then(resolve) { resolve({ data: null, error: null }); },
    };
    return chain;
  };
  return { from: (table) => chainFor(table) };
}

function authAs(db, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const req = (body) => new Request("https://t/", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "app_1" }) };

describe("application manage follow-up G21", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("O-11: reopens a denied application to pending", async () => {
    authAs(makeDb({ application: { id: "app_1", status: "denied", tenant_id: null, lease_id: null } }));
    const res = await POST(req({ action: "reopen", reason: "Second look" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).application.status).toBe("pending");
  });

  it("O-11: reopens a withdrawn application to pending", async () => {
    authAs(makeDb({ application: { id: "app_1", status: "withdrawn", tenant_id: null, lease_id: null } }));
    const res = await POST(req({ action: "reopen" }), params);
    expect(res.status).toBe(200);
  });

  it("O-11: pre-migration CHECK violation is a 503 with status untouched", async () => {
    const db = makeDb({
      application: { id: "app_1", status: "denied", tenant_id: null, lease_id: null },
      auditError: { code: "23514", message: 'check constraint "rental_application_decisions_action_check" violated' },
    });
    authAs(db);
    const res = await POST(req({ action: "reopen" }), params);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("has not been applied yet");
  });

  it("O-11: approved cannot reopen or delete", async () => {
    authAs(makeDb({ application: { id: "app_1", status: "approved", tenant_id: "t1", lease_id: "l1" } }));
    const reopen = await POST(req({ action: "reopen" }), params);
    expect(reopen.status).toBe(409);
    const deleted = await POST(req({ action: "delete" }), params);
    expect(deleted.status).toBe(409);
  });

  it("O-11: denied cannot delete (audit trail); pending and withdrawn can", async () => {
    authAs(makeDb({ application: { id: "app_1", status: "denied", tenant_id: null, lease_id: null } }));
    expect((await POST(req({ action: "delete" }), params)).status).toBe(409);
    const deleted = [];
    const db = makeDb({ application: { id: "app_1", status: "pending", tenant_id: null, lease_id: null }, deleted });
    authAs(db);
    const res = await POST(req({ action: "delete" }), params);
    expect(res.status).toBe(200);
    expect(deleted).toContain("rental_applications");
  });

  it("O-11: delete refuses a linked tenant/lease even when pending", async () => {
    authAs(makeDb({ application: { id: "app_1", status: "pending", tenant_id: "t1", lease_id: null } }));
    expect((await POST(req({ action: "delete" }), params)).status).toBe(409);
  });

  it("O-11: read-only members and unknown applications are blocked", async () => {
    authAs(makeDb({ application: { id: "app_1", status: "pending", tenant_id: null, lease_id: null } }), "read_only");
    expect((await POST(req({ action: "reopen" }), params)).status).toBe(403);
    authAs(makeDb({ application: null }));
    expect((await POST(req({ action: "reopen" }), params)).status).toBe(404);
  });
});
