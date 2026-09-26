import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET, PUT } from "./route";

function chainable(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
    upsert: (payload) => { builder.upsertedWith = payload; return Promise.resolve(result); },
  };
  return builder;
}

function fakeSupabase({ user = { id: "user-1" }, authError = null, fromResult = { data: null, error: null } }) {
  const builder = chainable(fromResult);
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }) }, from: vi.fn(() => builder), builder };
}

function putRequest(layoutKey, body) {
  return new Request(`http://localhost/api/preferences/dashboard-layout/${layoutKey}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(layoutKey) {
  return { params: Promise.resolve({ layoutKey }) };
}

const SECTION_IDS = ["activity", "intelligence", "position", "compare", "ask-books", "brain-actions", "anomalies", "cash-forecast", "left-this-month", "debt-payoff"];
const validLayout = { order: SECTION_IDS, hidden: ["anomalies"] };

describe("GET /api/preferences/dashboard-layout/[layoutKey]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unknown layout key before checking authentication", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    const response = await GET(null, ctx("not-a-real-layout"));
    expect(response.status).toBe(400);
  });

  it("returns null layout when the user has never saved one", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await GET(null, ctx("financial-sections"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.layout).toBeNull();
    expect(body.updatedAt).toBeNull();
  });

  it("returns the stored layout and updatedAt", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({
      fromResult: { data: { layout: validLayout, updated_at: "2026-09-26T10:00:00Z" }, error: null },
    }));
    const response = await GET(null, ctx("financial-sections"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.layout).toEqual(validLayout);
    expect(body.updatedAt).toBe("2026-09-26T10:00:00Z");
  });

  it("requires authentication for known keys", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    const response = await GET(null, ctx("financial-kpis"));
    expect(response.status).toBe(401);
  });
});

describe("PUT /api/preferences/dashboard-layout/[layoutKey]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unknown layout key", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PUT(putRequest("nope", { layout: validLayout }), ctx("nope"));
    expect(response.status).toBe(400);
  });

  it("upserts a valid layout with the server timestamp", async () => {
    const supabase = fakeSupabase({});
    mocks.createClient.mockResolvedValue(supabase);
    const response = await PUT(putRequest("financial-sections", { layout: validLayout }), ctx("financial-sections"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.layout).toEqual(validLayout);
    expect(typeof body.updatedAt).toBe("string");
    expect(supabase.builder.upsertedWith.user_id).toBe("user-1");
    expect(supabase.builder.upsertedWith.layout_key).toBe("financial-sections");
    expect(supabase.builder.upsertedWith.layout).toEqual(validLayout);
  });

  it("rejects an unknown card id", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PUT(
      putRequest("financial-sections", { layout: { order: SECTION_IDS, hidden: ["nope"] } }),
      ctx("financial-sections"),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a duplicate card id within order", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const dupOrder = [...SECTION_IDS, "activity"];
    const response = await PUT(
      putRequest("financial-sections", { layout: { order: dupOrder, hidden: [] } }),
      ctx("financial-sections"),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an order that drops a registry card", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PUT(
      putRequest("financial-sections", { layout: { order: SECTION_IDS.slice(1), hidden: [] } }),
      ctx("financial-sections"),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a KPI id in the sections zone", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PUT(
      putRequest("financial-sections", { layout: { order: [...SECTION_IDS.slice(1), "equity"], hidden: [] } }),
      ctx("financial-sections"),
    );
    expect(response.status).toBe(400);
  });

  it("accepts the KPI zone with its own registry", async () => {
    const supabase = fakeSupabase({});
    mocks.createClient.mockResolvedValue(supabase);
    const kpiLayout = { order: ["equity", "cash", "profit", "margin"], hidden: [] };
    const response = await PUT(putRequest("financial-kpis", { layout: kpiLayout }), ctx("financial-kpis"));
    expect(response.status).toBe(200);
    expect(supabase.builder.upsertedWith.layout_key).toBe("financial-kpis");
  });

  it("requires authentication", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    const response = await PUT(putRequest("financial-sections", { layout: validLayout }), ctx("financial-sections"));
    expect(response.status).toBe(401);
  });
});
