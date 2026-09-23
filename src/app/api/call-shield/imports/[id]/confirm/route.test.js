import { describe, expect, it, vi } from "vitest";

const { guardCallShieldRequest } = vi.hoisted(() => ({ guardCallShieldRequest: vi.fn() }));
vi.mock("../../../_lib/auth.js", () => ({ guardCallShieldRequest }));

const route = await import("./route.js");
const { authedGuard, mockSupabase } = await import("../../../_lib/testUtils.js");
const { NextRequest } = await import("next/server");

const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CASE_ID = "33333333-3333-4333-8333-333333333333";

const IMPORT_ROW = {
  id: IMPORT_ID,
  phone_number: "(713) 239-9946",
  caller_name: "Cruise Agency",
  started_at: "2026-09-23T15:23:00.000Z",
  duration_seconds: 45,
  call_type: "incoming",
  matched_case_id: null,
  dismissed: false,
};

const CASE_OPENED_ROW = {
  id: "event-1",
  type: "CASE_OPENED",
  payload: { caseId: CASE_ID, reportedBusinessName: "Cruise Agency" },
  recorded_at: "2026-09-23T15:00:00.000Z",
  seq: 0,
};

function confirmJson(body, params) {
  const request = new NextRequest(`https://test/api/call-shield/imports/${IMPORT_ID}/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return route.POST(request, { params: Promise.resolve(params || { id: IMPORT_ID }) });
}

function methodsOf(db, method) {
  return db._calls.filter(([m]) => m === method);
}

describe("POST /api/call-shield/imports/[id]/confirm", () => {
  it("appends the call event and marks the import matched in one request", async () => {
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null }, // import row
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [CASE_OPENED_ROW], error: null }, // case events
      { data: { seq: 0 }, error: null }, // max seq
      { data: null, error: null }, // insert event
      { data: { id: IMPORT_ID }, error: null }, // mark matched
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const insertCall = methodsOf(db, "insert")[0];
    const inserted = insertCall[1][0];
    expect(inserted.type).toBe("CALL_LOGGED");
    expect(inserted.payload.numberShown).toBe("(713) 239-9946");
    expect(inserted.payload.direction).toBe("incoming");
    expect(inserted.payload.businessNameStated).toBe("Cruise Agency");
    expect(inserted.payload.sourceImportId).toBe(IMPORT_ID);

    const updateCall = methodsOf(db, "update")[0];
    expect(updateCall[1][0]).toEqual({ matched_case_id: CASE_ID, dismissed: false });
  });

  it("is idempotent: an already-matched import returns success without appending", async () => {
    const db = mockSupabase([
      { data: { ...IMPORT_ROW, matched_case_id: CASE_ID }, error: null },
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.alreadyMatched).toBe(true);
    expect(methodsOf(db, "insert")).toHaveLength(0);
    expect(methodsOf(db, "update")).toHaveLength(0);
  });

  it("refuses to move an import that is already logged on another case", async () => {
    const db = mockSupabase([
      { data: { ...IMPORT_ROW, matched_case_id: OTHER_CASE_ID }, error: null },
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    expect(response.status).toBe(409);
    expect(methodsOf(db, "insert")).toHaveLength(0);
    expect(methodsOf(db, "update")).toHaveLength(0);
  });

  it("recovers after a crash between event append and matched-mark: marks matched without duplicating", async () => {
    const existingEvent = {
      id: "event-9",
      type: "CALL_LOGGED",
      payload: { numberShown: "(713) 239-9946", sourceImportId: IMPORT_ID },
      recorded_at: "2026-09-23T15:30:00.000Z",
      seq: 1,
    };
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null }, // import row, still unmatched
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [CASE_OPENED_ROW, existingEvent], error: null }, // events incl. the orphaned one
      { data: { id: IMPORT_ID }, error: null }, // mark matched
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(true);
    // No second event appended — only the matched-mark update ran.
    expect(methodsOf(db, "insert")).toHaveLength(0);
    const updateCall = methodsOf(db, "update")[0];
    expect(updateCall[1][0]).toEqual({ matched_case_id: CASE_ID, dismissed: false });
  });

  it("returns 404 when the import is not the owner's", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await confirmJson({ caseId: CASE_ID });
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the case is not the owner's", async () => {
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null },
      { data: null, error: null }, // case check: not found
    ]);
    authedGuard(guardCallShieldRequest, db);
    const response = await confirmJson({ caseId: CASE_ID });
    expect(response.status).toBe(404);
    expect(methodsOf(db, "insert")).toHaveLength(0);
  });

  it("rejects a malformed caseId without touching the database", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await confirmJson({ caseId: "not-a-uuid" });
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    const db = mockSupabase([]);
    guardCallShieldRequest.mockResolvedValue({
      response: (await import("next/server")).NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response = await confirmJson({ caseId: CASE_ID });
    expect(response.status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });
});
