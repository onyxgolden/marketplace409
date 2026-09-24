import { describe, expect, it, vi } from "vitest";

const { guardCallShieldRequest } = vi.hoisted(() => ({ guardCallShieldRequest: vi.fn() }));
vi.mock("../../../_lib/auth.js", () => ({ guardCallShieldRequest }));

const route = await import("./route.js");
const { authedGuard, mockSupabase, postJson } = await import("../../../_lib/testUtils.js");

const CASE_ID = "11111111-1111-4111-8111-111111111111";

// A real timeline always starts with CASE_OPENED; the domain asserts on it.
const OPENED_EVENT_ROW = {
  id: "event-opened",
  type: "CASE_OPENED",
  payload: { caseId: CASE_ID, reportedBusinessName: "Cruise Co" },
  recorded_at: "2026-09-23T16:00:00.000Z",
};

describe("POST /api/call-shield/cases/[id]/events", () => {
  it("appends a CALL_LOGGED event through the domain and assigns seq 0 on an empty timeline", async () => {
    const db = mockSupabase([
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [OPENED_EVENT_ROW], error: null }, // existing events
      { data: null, error: null }, // max(seq)
      { data: null, error: null }, // event insert
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await postJson(route, `https://test/api/call-shield/cases/${CASE_ID}/events`, {
      kind: "call",
      numberShown: "(713) 239-9946",
      occurredAt: "2026-09-23T15:23:00.000Z",
      direction: "incoming",
    }, { id: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.event.type).toBe("CALL_LOGGED");
    expect(body.event.payload.numberShown).toBe("(713) 239-9946");

    const insertCalls = db._calls.filter(([method]) => method === "insert");
    expect(insertCalls).toHaveLength(1);
    const persisted = insertCalls[0][1][0];
    expect(persisted.case_id).toBe(CASE_ID);
    expect(persisted.owner_id).toBe("owner-1");
    expect(persisted.type).toBe("CALL_LOGGED");
    expect(persisted.seq).toBe(0);
  });

  it("retries on a seq race instead of failing", async () => {
    const db = mockSupabase([
      { data: { id: CASE_ID }, error: null }, // case ownership check
      { data: [OPENED_EVENT_ROW], error: null }, // existing events
      { data: { seq: 0 }, error: null }, // max(seq), first attempt
      { error: { code: "23505", message: "duplicate key" } }, // lost the race
      { data: { seq: 1 }, error: null }, // max(seq), retry
      { error: null }, // insert succeeds with seq 2
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await postJson(route, `https://test/api/call-shield/cases/${CASE_ID}/events`, {
      kind: "call",
      numberShown: "(713) 239-9946",
    }, { id: CASE_ID });
    const body = await response.json();

    expect(response.status).toBe(201);
    const insertCalls = db._calls.filter(([method]) => method === "insert");
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1][0].seq).toBe(1);
    expect(insertCalls[1][1][0].seq).toBe(2);
    expect(body.success).toBe(true);
  });

  it("returns 404 for a case that is not the owner's", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await postJson(route, `https://test/api/call-shield/cases/${CASE_ID}/events`, {
      kind: "call",
      numberShown: "(713) 239-9946",
    }, { id: CASE_ID });
    expect(response.status).toBe(404);
  });

  it("rejects unsupported event kinds", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await postJson(route, `https://test/api/call-shield/cases/${CASE_ID}/events`, {
      kind: "opt-out",
    }, { id: CASE_ID });
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid call through the domain (400, not 500)", async () => {
    const db = mockSupabase([
      { data: { id: CASE_ID }, error: null },
      { data: [], error: null },
    ]);
    authedGuard(guardCallShieldRequest, db);
    const response = await postJson(route, `https://test/api/call-shield/cases/${CASE_ID}/events`, {
      kind: "call",
      numberShown: "not-a-number",
    }, { id: CASE_ID });
    expect(response.status).toBe(400);
  });
});
