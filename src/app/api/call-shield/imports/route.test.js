import { describe, expect, it, vi } from "vitest";

const { guardCallShieldRequest } = vi.hoisted(() => ({ guardCallShieldRequest: vi.fn() }));
vi.mock("../_lib/auth.js", () => ({ guardCallShieldRequest }));

const route = await import("./route.js");
const { authedGuard, mockSupabase, postJson } = await import("../_lib/testUtils.js");
const { buildImportDedupeHash, normalizePhoneNumber } = await import(
  "@/domains/callShield/callShieldImport"
);

function validRecord(overrides = {}) {
  return {
    androidCallId: "77",
    phoneNumber: "(713) 239-9946",
    callerName: "Cruise Line",
    startedAt: "2026-09-23T15:23:00.000Z",
    durationSeconds: 45,
    callType: "incoming",
    deviceId: "device-1",
    ...overrides,
  };
}

describe("POST /api/call-shield/imports", () => {
  it("stages records with server-recomputed dedupe hashes, ignoring client hashes", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);

    const response = await postJson(route, "https://test/api/call-shield/imports", {
      records: [validRecord({ dedupeHash: "client-forged-hash" })],
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.received).toBe(1);
    const upsertCall = db._calls.find(([method]) => method === "upsert");
    expect(upsertCall).toBeTruthy();
    const row = upsertCall[1][0][0];
    const normalizedPhone = normalizePhoneNumber("(713) 239-9946");
    const expectedHash = buildImportDedupeHash({
      normalizedPhone,
      startedAtISO: new Date("2026-09-23T15:23:00.000Z").toISOString(),
      durationSeconds: 45,
      callType: "incoming",
    });
    expect(row.dedupe_hash).toBe(expectedHash);
    expect(row.dedupe_hash).not.toBe("client-forged-hash");
    expect(row.owner_id).toBe("owner-1");
  });

  it("rejects a record with no usable phone number", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await postJson(route, "https://test/api/call-shield/imports", {
      records: [validRecord({ phoneNumber: "---" })],
    });
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects more than 500 records", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await postJson(route, "https://test/api/call-shield/imports", {
      records: Array.from({ length: 501 }, () => validRecord()),
    });
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { NextResponse } = await import("next/server");
    guardCallShieldRequest.mockResolvedValue({
      response: NextResponse.json({ error: "nope" }, { status: 401 }),
    });
    const response = await postJson(route, "https://test/api/call-shield/imports", {
      records: [validRecord()],
    });
    expect(response.status).toBe(401);
  });
});

function importRow(id) {
  return {
    id,
    device_id: "device-1",
    phone_number: "(713) 239-9946",
    normalized_phone: "17132399946",
    started_at: "2026-09-23T15:23:00.000Z",
    duration_seconds: 45,
    call_type: "incoming",
    caller_name: "Cruise Line",
    imported_at: "2026-09-23T16:00:00.000Z",
    matched_case_id: null,
    dismissed: false,
  };
}

describe("GET /api/call-shield/imports", () => {
  it("returns the first page with page metadata and the total", async () => {
    const db = mockSupabase([{ data: [importRow("a"), importRow("b")], count: 350, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const { NextRequest } = await import("next/server");
    const response = await route.GET(new NextRequest("https://test/api/call-shield/imports"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(200);
    expect(body.total).toBe(350);
    expect(db._calls).toContainEqual(["range", [0, 199]]);
  });

  it("honors page and pageSize params", async () => {
    const db = mockSupabase([{ data: [importRow("c")], count: 350, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const { NextRequest } = await import("next/server");
    const response = await route.GET(
      new NextRequest("https://test/api/call-shield/imports?page=2&pageSize=50"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBe(350);
    expect(db._calls).toContainEqual(["range", [50, 99]]);
  });

  it("requires authentication", async () => {
    const { NextRequest, NextResponse } = await import("next/server");
    guardCallShieldRequest.mockResolvedValue({
      response: NextResponse.json({ error: "nope" }, { status: 401 }),
    });
    const response = await route.GET(new NextRequest("https://test/api/call-shield/imports"));
    expect(response.status).toBe(401);
  });
});
