import { describe, expect, it, vi } from "vitest";

const { guardCallShieldRequest } = vi.hoisted(() => ({ guardCallShieldRequest: vi.fn() }));
vi.mock("../_lib/auth.js", () => ({ guardCallShieldRequest }));

const route = await import("./route.js");
const { authedGuard, mockSupabase, postJson } = await import("../_lib/testUtils.js");
const { NextRequest } = await import("next/server");

describe("POST /api/call-shield/cases", () => {
  it("opens a case: header row uses the domain's case id and the CASE_OPENED event is persisted", async () => {
    const headerRow = {
      id: "case-1",
      owner_id: "owner-1",
      reported_business_name: "Cruise Co",
      notes: null,
      created_at: "2026-09-23T16:00:00.000Z",
      updated_at: "2026-09-23T16:00:00.000Z",
    };
    const db = mockSupabase([
      { data: null, error: null }, // header insert
      { data: null, error: null }, // max(seq)
      { data: null, error: null }, // event insert
      { data: headerRow, error: null }, // header re-read
    ]);
    authedGuard(guardCallShieldRequest, db);

    const response = await postJson(route, "https://test/api/call-shield/cases", {
      reportedBusinessName: "Cruise Co",
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.item.reportedBusinessName).toBe("Cruise Co");

    const insertCalls = db._calls.filter(([method]) => method === "insert");
    expect(insertCalls).toHaveLength(2);
    const headerInsert = insertCalls[0][1][0];
    const eventInsert = insertCalls[1][1][0];
    // Header id and event case_id come from the same domain-generated id.
    expect(headerInsert.id).toBe(eventInsert.case_id);
    expect(headerInsert.owner_id).toBe("owner-1");
    expect(eventInsert.type).toBe("CASE_OPENED");
    expect(eventInsert.seq).toBe(0);
  });

  it("rejects a case with no business name before touching the database", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await postJson(route, "https://test/api/call-shield/cases", {
      reportedBusinessName: "   ",
    });
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("GET /api/call-shield/cases", () => {
  it("lists the owner's cases newest first", async () => {
    const db = mockSupabase([
      { data: [{ id: "case-2" }, { id: "case-1" }], error: null },
    ]);
    authedGuard(guardCallShieldRequest, db);
    const response = await route.GET(new NextRequest("https://test/api/call-shield/cases"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items.map((i) => i.id)).toEqual(["case-2", "case-1"]);
  });
});
