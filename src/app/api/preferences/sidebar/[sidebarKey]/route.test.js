import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET, PATCH } from "./route";

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

function patchRequest(body) {
  return new Request("http://localhost/api/preferences/sidebar/rental-manager", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(sidebarKey) {
  return { params: Promise.resolve({ sidebarKey }) };
}

describe("GET /api/preferences/sidebar/[sidebarKey]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unknown sidebar key before checking authentication", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    const response = await GET(null, ctx("financial"));
    expect(response.status).toBe(400);
  });

  it("requires authentication", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    expect((await GET(null, ctx("rental-manager"))).status).toBe(401);
  });

  it("returns an empty array when no preference has been saved yet", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ fromResult: { data: null, error: null } }));
    const response = await GET(null, ctx("rental-manager"));
    expect((await response.json()).hiddenItemIds).toEqual([]);
  });

  it("returns the saved hidden item ids", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ fromResult: { data: { hidden_item_ids: ["support", "rentec-migration"] }, error: null } }));
    const response = await GET(null, ctx("rental-manager"));
    expect((await response.json()).hiddenItemIds).toEqual(["support", "rentec-migration"]);
  });

  it("surfaces a 500 when the query itself fails", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ fromResult: { data: null, error: { message: "boom" } } }));
    expect((await GET(null, ctx("rental-manager"))).status).toBe(500);
  });
});

describe("PATCH /api/preferences/sidebar/[sidebarKey]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unknown sidebar key", async () => {
    const response = await PATCH(patchRequest({ hiddenItemIds: [] }), ctx("not-a-real-sidebar"));
    expect(response.status).toBe(400);
  });

  it("requires authentication", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    expect((await PATCH(patchRequest({ hiddenItemIds: ["support"] }), ctx("rental-manager"))).status).toBe(401);
  });

  it("rejects a non-array hiddenItemIds", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PATCH(patchRequest({ hiddenItemIds: "support" }), ctx("rental-manager"));
    expect(response.status).toBe(400);
  });

  it("rejects an array containing a non-string or empty entry", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    expect((await PATCH(patchRequest({ hiddenItemIds: ["support", 42] }), ctx("rental-manager"))).status).toBe(400);
    expect((await PATCH(patchRequest({ hiddenItemIds: ["support", ""] }), ctx("rental-manager"))).status).toBe(400);
  });

  it("upserts the deduplicated hidden item ids for the authenticated user and sidebar key", async () => {
    const supabase = fakeSupabase({ user: { id: "user-42" } });
    mocks.createClient.mockResolvedValue(supabase);
    const response = await PATCH(patchRequest({ hiddenItemIds: ["support", "rentec-migration", "support"] }), ctx("rental-manager"));
    expect(response.status).toBe(200);
    expect((await response.json()).hiddenItemIds).toEqual(["support", "rentec-migration"]);
    expect(supabase.builder.upsertedWith).toMatchObject({
      user_id: "user-42", sidebar_key: "rental-manager", hidden_item_ids: ["support", "rentec-migration"],
    });
  });

  it("accepts an empty array to reset to default (show everything)", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PATCH(patchRequest({ hiddenItemIds: [] }), ctx("rental-manager"));
    expect(response.status).toBe(200);
    expect((await response.json()).hiddenItemIds).toEqual([]);
  });

  it("surfaces a 500 when the upsert itself fails", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ fromResult: { data: null, error: { message: "boom" } } }));
    expect((await PATCH(patchRequest({ hiddenItemIds: ["support"] }), ctx("rental-manager"))).status).toBe(500);
  });
});
