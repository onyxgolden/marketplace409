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
  recorded_at: "2026-09-23T15:30:00.000Z",
  seq: 0,
};

const IMPORT_EVENT_ROW = {
  id: "event-9",
  type: "CALL_LOGGED",
  payload: { numberShown: "(713) 239-9946", sourceImportId: IMPORT_ID },
  recorded_at: "2026-09-23T15:30:00.000Z",
  seq: 1,
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
  it("claims the import, appends the call event, and returns success", async () => {
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null }, // import row
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [CASE_OPENED_ROW], error: null }, // case events
      { data: { id: IMPORT_ID }, error: null }, // claim update wins
      { data: { seq: 0 }, error: null }, // max seq
      { data: null, error: null }, // insert event
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // The claim is a single conditional UPDATE guarded by IS NULL.
    const updateCall = methodsOf(db, "update")[0];
    expect(updateCall[1][0]).toEqual({ matched_case_id: CASE_ID, dismissed: false });
    expect(db._calls).toContainEqual(["is", ["matched_case_id", null]]);

    const insertCall = methodsOf(db, "insert")[0];
    const inserted = insertCall[1][0];
    expect(inserted.type).toBe("CALL_LOGGED");
    expect(inserted.payload.numberShown).toBe("(713) 239-9946");
    expect(inserted.payload.direction).toBe("incoming");
    expect(inserted.payload.businessNameStated).toBe("Cruise Agency");
    expect(inserted.payload.sourceImportId).toBe(IMPORT_ID);
  });

  it("loser of a concurrent confirm race returns alreadyMatched without appending", async () => {
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null }, // import row, still unmatched
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [CASE_OPENED_ROW], error: null }, // case events
      { data: null, error: null }, // claim update: lost the race
      { data: { ...IMPORT_ROW, matched_case_id: CASE_ID }, error: null }, // re-read: winner claimed it
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.alreadyMatched).toBe(true);
    // No event appended by the loser.
    expect(methodsOf(db, "insert")).toHaveLength(0);
  });

  it("loser of a race against a different case gets 409", async () => {
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null },
      { data: { id: CASE_ID }, error: null },
      { data: [CASE_OPENED_ROW], error: null },
      { data: null, error: null }, // claim update: lost the race
      { data: { ...IMPORT_ROW, matched_case_id: OTHER_CASE_ID }, error: null }, // winner used another case
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    expect(response.status).toBe(409);
    expect(methodsOf(db, "insert")).toHaveLength(0);
  });

  it("recovers after a crash between claim and event append: appends without duplicating", async () => {
    const db = mockSupabase([
      { data: { ...IMPORT_ROW, matched_case_id: CASE_ID }, error: null }, // claimed, no event yet
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [CASE_OPENED_ROW], error: null }, // events: no import event
      { data: { seq: 0 }, error: null }, // max seq
      { data: null, error: null }, // insert event
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(true);
    const insertCall = methodsOf(db, "insert")[0];
    expect(insertCall[1][0].payload.sourceImportId).toBe(IMPORT_ID);
  });

  it("is idempotent: an already-matched import with its event returns success without writing", async () => {
    const db = mockSupabase([
      { data: { ...IMPORT_ROW, matched_case_id: CASE_ID }, error: null },
      { data: { id: CASE_ID }, error: null },
      { data: [CASE_OPENED_ROW, IMPORT_EVENT_ROW], error: null },
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

  it("never double-appends when an orphaned event predates the claim", async () => {
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null }, // import row, still unmatched
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [CASE_OPENED_ROW, IMPORT_EVENT_ROW], error: null }, // events incl. an orphaned one
      { data: { id: IMPORT_ID }, error: null }, // claim update wins
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await confirmJson({ caseId: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(true);
    expect(methodsOf(db, "insert")).toHaveLength(0);
  });

  it("returns 404 when the import is not the owner's", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await confirmJson({ caseId: CASE_ID });
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the case is not the owner's, without claiming", async () => {
    const db = mockSupabase([
      { data: IMPORT_ROW, error: null },
      { data: null, error: null }, // case check: not found
    ]);
    authedGuard(guardCallShieldRequest, db);
    const response = await confirmJson({ caseId: CASE_ID });
    expect(response.status).toBe(404);
    expect(methodsOf(db, "insert")).toHaveLength(0);
    expect(methodsOf(db, "update")).toHaveLength(0);
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
