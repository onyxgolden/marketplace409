import { describe, expect, it, vi } from "vitest";

const { guardCallShieldRequest } = vi.hoisted(() => ({ guardCallShieldRequest: vi.fn() }));
vi.mock("../_lib/auth.js", () => ({ guardCallShieldRequest }));

const route = await import("./route.js");
const { labelRowId } = route;
const { authedGuard, mockSupabase, postJson } = await import("../_lib/testUtils.js");

function upsertCall(db) {
  return db._calls.find(([method]) => method === "upsert");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("labelRowId", () => {
  it("is a deterministic v5 UUID per owner + number", () => {
    const a = labelRowId("owner-1", "7132399946");
    const b = labelRowId("owner-1", "7132399946");
    expect(a).toBe(b);
    expect(a).toMatch(UUID_RE);
  });

  it("differs across numbers and owners", () => {
    expect(labelRowId("owner-1", "7132399946")).not.toBe(labelRowId("owner-1", "5551234567"));
    expect(labelRowId("owner-1", "7132399946")).not.toBe(labelRowId("owner-2", "7132399946"));
  });
});

describe("POST /api/call-shield/labels", () => {
  it("upserts a label keyed on the normalized phone number", async () => {
    const db = mockSupabase([{ data: { id: "l1" }, error: null }]);
    authedGuard(guardCallShieldRequest, db);

    const response = await postJson(route, "https://test/api/call-shield/labels", {
      phoneNumber: "(713) 239-9946",
      label: "offender",
      symbol: "🚫",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item.id).toBe("l1");
    const [, [payload, options]] = upsertCall(db);
    expect(options).toMatchObject({ onConflict: "owner_id,normalized_phone" });
    expect(payload.normalized_phone).toBe("7132399946");
    expect(payload.phone_number).toBe("(713) 239-9946");
    expect(payload.label).toBe("offender");
    expect(payload.symbol).toBe("🚫");
    expect(payload.owner_id).toBe("owner-1");
    expect(payload.id).toMatch(UUID_RE);
  });

  it("uses a single atomic statement, so concurrent requests cannot race into a 500", async () => {
    const db = mockSupabase([{ data: { id: "l9", label: "offender" }, error: null }]);
    authedGuard(guardCallShieldRequest, db);

    const response = await postJson(route, "https://test/api/call-shield/labels", {
      phoneNumber: "7132399946",
      label: "personal",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item.id).toBe("l9");
    // No update-then-insert pair: exactly one upsert ran.
    const upserts = db._calls.filter(([method]) => method === "upsert");
    expect(upserts).toHaveLength(1);
    expect(db._calls.some(([method]) => method === "update")).toBe(false);
    expect(db._calls.some(([method]) => method === "insert")).toBe(false);
    const [, [payload]] = upserts[0];
    expect(payload.owner_id).toBe("owner-1");
    expect(payload.normalized_phone).toBe("7132399946");
  });

  it("preserves the row id across re-marks (deterministic id)", async () => {
    const db = mockSupabase([
      { data: { id: "l7" }, error: null },
      { data: { id: "l7" }, error: null },
    ]);
    authedGuard(guardCallShieldRequest, db);

    const first = await postJson(route, "https://test/api/call-shield/labels", {
      phoneNumber: "7132399946",
      label: "offender",
    });
    const second = await postJson(route, "https://test/api/call-shield/labels", {
      phoneNumber: "7132399946",
      label: "personal",
    });

    const [, [payloadA]] = db._calls.filter(([method]) => method === "upsert")[0] || [];
    const upsertCalls = db._calls.filter(([method]) => method === "upsert");
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0][1][0].id).toBe(upsertCalls[1][1][0].id);
    expect(payloadA.id).toBe(labelRowId("owner-1", "7132399946"));
    expect((await first.json()).item.id).toBe("l7");
    expect((await second.json()).item.id).toBe("l7");
  });

  it("defaults the offender symbol", async () => {
    const db = mockSupabase([{ data: { id: "l2" }, error: null }]);
    authedGuard(guardCallShieldRequest, db);

    const response = await postJson(route, "https://test/api/call-shield/labels", {
      phoneNumber: "5551234567",
      label: "personal",
    });
    expect(response.status).toBe(200);
    const [, [payload]] = upsertCall(db);
    expect(payload.label).toBe("personal");
    expect(payload.symbol).toBe("⚠");
  });

  it("rejects an unknown label and a missing number", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);

    const badLabel = await postJson(route, "https://test/api/call-shield/labels", {
      phoneNumber: "7132399946",
      label: "friend",
    });
    expect(badLabel.status).toBe(400);

    const noNumber = await postJson(route, "https://test/api/call-shield/labels", {
      label: "personal",
    });
    expect(noNumber.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/call-shield/labels", () => {
  it("deletes by normalized number for the owner", async () => {
    const db = mockSupabase([{ data: null, error: null }]);
    authedGuard(guardCallShieldRequest, db);

    const response = await route.DELETE(
      new Request("https://test/api/call-shield/labels?phoneNumber=%2B1%20(713)%20239-9946"),
    );
    expect(response.status).toBe(200);
    const eqCalls = db._calls.filter(([method]) => method === "eq").map(([, args]) => args);
    expect(eqCalls).toContainEqual(["owner_id", "owner-1"]);
    expect(eqCalls).toContainEqual(["normalized_phone", "7132399946"]);
  });

  it("requires a phone number", async () => {
    const db = mockSupabase([]);
    authedGuard(guardCallShieldRequest, db);
    const response = await route.DELETE(new Request("https://test/api/call-shield/labels"));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/call-shield/labels", () => {
  it("lists the owner's labels with pagination metadata", async () => {
    const db = mockSupabase([{ data: [{ id: "l1" }], count: 1, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await route.GET(new Request("https://test/api/call-shield/labels"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(500);
    expect(body.total).toBe(1);
    const [, args] = db._calls.find(([method]) => method === "range");
    expect(args).toEqual([0, 499]);
  });

  it("honors page and pageSize params and clamps pageSize", async () => {
    const db = mockSupabase([{ data: [], count: 0, error: null }]);
    authedGuard(guardCallShieldRequest, db);
    const response = await route.GET(
      new Request("https://test/api/call-shield/labels?page=3&pageSize=50"),
    );
    const body = await response.json();
    expect(body.page).toBe(3);
    expect(body.pageSize).toBe(50);
    const [, args] = db._calls.find(([method]) => method === "range");
    expect(args).toEqual([100, 149]);

    const db2 = mockSupabase([{ data: [], count: 0, error: null }]);
    authedGuard(guardCallShieldRequest, db2);
    const big = await route.GET(new Request("https://test/api/call-shield/labels?pageSize=99999"));
    expect((await big.json()).pageSize).toBe(1000);
  });
});
