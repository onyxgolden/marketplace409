import { describe, expect, it, vi } from "vitest";

const { guardCallShieldRequest } = vi.hoisted(() => ({ guardCallShieldRequest: vi.fn() }));
vi.mock("../../_lib/auth.js", () => ({ guardCallShieldRequest }));

const route = await import("./route.js");
const { authedGuard, mockSupabase } = await import("../../_lib/testUtils.js");
const { NextRequest } = await import("next/server");

const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "11111111-1111-4111-8111-111111111111";

function patchJson(body, params) {
  const request = new NextRequest(`https://test/api/call-shield/imports/${IMPORT_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return route.PATCH(request, { params: Promise.resolve(params || { id: IMPORT_ID }) });
}

describe("PATCH /api/call-shield/imports/[id]", () => {
  it("confirms a case association only after verifying the case belongs to the owner", async () => {
    const db = mockSupabase([
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: { id: IMPORT_ID }, error: null }, // update
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await patchJson({ matchedCaseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const updateCall = db._calls.find(([method]) => method === "update");
    expect(updateCall[1][0]).toEqual({ matched_case_id: CASE_ID });
  });

  it("refuses to associate with another owner's case", async () => {
    const db = mockSupabase([{ data: null, error: null }]); // case check: not found
    authedGuard(guardCallShieldRequest, db);
    const response = await patchJson({ matchedCaseId: CASE_ID });
    expect(response.status).toBe(404);
    expect(db._calls.some(([method]) => method === "update")).toBe(false);
  });

  it("rejects a malformed matchedCaseId", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await patchJson({ matchedCaseId: "not-a-uuid" });
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("dismisses an import", async () => {
    const db = mockSupabase([{ data: { id: IMPORT_ID }, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await patchJson({ dismissed: true });
    expect(response.status).toBe(200);
    const updateCall = db._calls.find(([method]) => method === "update");
    expect(updateCall[1][0]).toEqual({ dismissed: true });
  });

  it("rejects an empty patch", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await patchJson({});
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/call-shield/imports/[id]", () => {
  it("deletes the owner's staged row", async () => {
    const db = mockSupabase([{ data: { id: IMPORT_ID }, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const request = new NextRequest(`https://test/api/call-shield/imports/${IMPORT_ID}`, { method: "DELETE" });
    const response = await route.DELETE(request, { params: Promise.resolve({ id: IMPORT_ID }) });
    expect(response.status).toBe(200);
    expect(db._calls.some(([method]) => method === "delete")).toBe(true);
  });

  it("returns 404 when the row is not the owner's", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const request = new NextRequest(`https://test/api/call-shield/imports/${IMPORT_ID}`, { method: "DELETE" });
    const response = await route.DELETE(request, { params: Promise.resolve({ id: IMPORT_ID }) });
    expect(response.status).toBe(404);
  });
});
