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
