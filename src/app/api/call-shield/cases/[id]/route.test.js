import { describe, expect, it, vi } from "vitest";

const { guardCallShieldRequest } = vi.hoisted(() => ({ guardCallShieldRequest: vi.fn() }));
vi.mock("../../_lib/auth.js", () => ({ guardCallShieldRequest }));

const route = await import("./route.js");
const { authedGuard, mockSupabase } = await import("../../_lib/testUtils.js");
const { NextRequest } = await import("next/server");

const CASE_ID = "11111111-1111-4111-8111-111111111111";

const HEADER_ROW = {
  id: CASE_ID,
  owner_id: "owner-1",
  reported_business_name: "Cruise Co",
  notes: null,
  recording_notice_acknowledged_at: null,
  created_at: "2026-09-23T16:00:00.000Z",
  updated_at: "2026-09-23T16:00:00.000Z",
};

function eventRows() {
  return [
    {
      id: "event-opened",
      type: "CASE_OPENED",
      payload: { caseId: CASE_ID, reportedBusinessName: "Cruise Co" },
      recorded_at: "2026-09-23T16:00:00.000Z",
    },
    {
      id: "event-call",
      type: "CALL_LOGGED",
      payload: {
        caseId: CASE_ID,
        callId: "call-1",
        numberShown: "(713) 239-9946",
        occurredAt: "2026-09-23T15:23:00.000Z",
        direction: "incoming",
      },
      recorded_at: "2026-09-23T16:01:00.000Z",
    },
  ];
}

describe("GET /api/call-shield/cases/[id]", () => {
  it("rebuilds the case from its timeline, exposing calls for duplicate detection", async () => {
    const db = mockSupabase([
      { data: HEADER_ROW, error: null },
      { data: eventRows(), error: null },
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await route.GET(
      new NextRequest(`https://test/api/call-shield/cases/${CASE_ID}`),
      { params: Promise.resolve({ id: CASE_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item.reportedBusinessName).toBe("Cruise Co");
    expect(body.item.callCount).toBe(1);
    expect(body.item.calls).toHaveLength(1);
    expect(body.item.calls[0]).toMatchObject({
      numberShown: "(713) 239-9946",
      occurredAt: "2026-09-23T15:23:00.000Z",
    });
  });

  it("returns 404 for another owner's case", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await route.GET(
      new NextRequest(`https://test/api/call-shield/cases/${CASE_ID}`),
      { params: Promise.resolve({ id: CASE_ID }) },
    );
    expect(response.status).toBe(404);
  });
});

async function patchJson(path, body) {
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(path, { method: "PATCH", body: JSON.stringify(body) });
  return route.PATCH(request, { params: Promise.resolve({ id: CASE_ID }) });
}

async function deleteCase(path) {
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(path, { method: "DELETE" });
  return route.DELETE(request, { params: Promise.resolve({ id: CASE_ID }) });
}

describe("PATCH /api/call-shield/cases/[id]", () => {
  it("renames the case and returns the rebuilt item", async () => {
    const db = mockSupabase([
      { data: { id: CASE_ID }, error: null }, // ownership check
      { data: null, error: null }, // update
      { data: { ...HEADER_ROW, reported_business_name: "Renamed Co", notes: "updated notes" }, error: null },
      { data: eventRows(), error: null },
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await patchJson(`https://test/api/call-shield/cases/${CASE_ID}`, {
      reportedBusinessName: "  Renamed Co ",
      notes: "updated notes",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item.reportedBusinessName).toBe("Renamed Co");
    expect(body.item.notes).toBe("updated notes");
    // The update wrote the trimmed name to the header row.
    const updateCall = db._calls.find(([method]) => method === "update");
    expect(updateCall[1][0]).toMatchObject({
      reported_business_name: "Renamed Co",
      notes: "updated notes",
    });
    // Ownership was verified before the write.
    expect(db.from.mock.calls.map(([table]) => table)).toEqual([
      "call_shield_cases",
      "call_shield_cases",
      "call_shield_cases",
      "call_shield_case_events",
    ]);
  });

  it("returns 404 for another owner's case", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await patchJson(`https://test/api/call-shield/cases/${CASE_ID}`, {
      reportedBusinessName: "Renamed Co",
    });
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty business name without touching the database", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await patchJson(`https://test/api/call-shield/cases/${CASE_ID}`, {
      reportedBusinessName: "   ",
    });
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects a body with nothing to update", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await patchJson(`https://test/api/call-shield/cases/${CASE_ID}`, {});
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { NextResponse } = await import("next/server");
    guardCallShieldRequest.mockResolvedValue({
      response: NextResponse.json({ error: "nope" }, { status: 401 }),
    });
    const response = await patchJson(`https://test/api/call-shield/cases/${CASE_ID}`, {
      reportedBusinessName: "Renamed Co",
    });
    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/call-shield/cases/[id]", () => {
  it("deletes the case, its events, and releases matched imports", async () => {
    const db = mockSupabase([
      { data: { id: CASE_ID }, error: null }, // ownership check
      { data: null, error: null }, // release imports
      { data: null, error: null }, // delete case row
      { data: null, error: null }, // delete events
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await deleteCase(`https://test/api/call-shield/cases/${CASE_ID}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(db.from.mock.calls.map(([table]) => table)).toEqual([
      "call_shield_cases",
      "android_call_imports",
      "call_shield_cases",
      "call_shield_case_events",
    ]);
    // Matched imports are released back to the review queue, not orphaned.
    const releaseCall = db._calls.find(([method]) => method === "update");
    expect(releaseCall[1][0]).toEqual({ matched_case_id: null });
    // Every write is owner-scoped.
    for (const [method, args] of db._calls) {
      if (method === "eq" && args[0] === "owner_id") expect(args[1]).toBe("owner-1");
    }
  });

  it("never destroys the timeline when the case delete fails", async () => {
    const db = mockSupabase([
      { data: { id: CASE_ID }, error: null }, // ownership check
      { data: null, error: null }, // release imports
      { data: null, error: { message: "boom" } }, // case delete fails
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await deleteCase(`https://test/api/call-shield/cases/${CASE_ID}`);

    expect(response.status).toBe(500);
    // Events are deleted last: the failing case delete means the timeline
    // was never touched.
    expect(db.from).not.toHaveBeenCalledWith("call_shield_case_events");
  });

  it("returns 404 for another owner's case", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await deleteCase(`https://test/api/call-shield/cases/${CASE_ID}`);
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("requires authentication", async () => {
    const { NextResponse } = await import("next/server");
    guardCallShieldRequest.mockResolvedValue({
      response: NextResponse.json({ error: "nope" }, { status: 401 }),
    });
    const response = await deleteCase(`https://test/api/call-shield/cases/${CASE_ID}`);
    expect(response.status).toBe(401);
  });
});
