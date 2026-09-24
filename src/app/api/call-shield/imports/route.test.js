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
