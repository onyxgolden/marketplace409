import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET, PATCH } from "./route";

function chainable(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
    upsert: () => Promise.resolve(result),
  };
  return builder;
}

function fakeSupabase({ user = { id: "user-1" }, authError = null, fromResult = { data: null, error: null } }) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }) },
    from: vi.fn(() => chainable(fromResult)),
  };
}

function patchRequest(body) {
  return new Request("http://localhost/api/preferences/favorite-workspace", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/preferences/favorite-workspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    expect((await GET()).status).toBe(401);
  });

  it("returns null when no favorite has been set yet", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ fromResult: { data: null, error: null } }));
    const response = await GET();
    expect((await response.json()).favoriteWorkspaceId).toBeNull();
  });

  it("returns the saved favorite", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ fromResult: { data: { favorite_workspace_id: "forge" }, error: null } }));
    const response = await GET();
    expect((await response.json()).favoriteWorkspaceId).toBe("forge");
  });
});

describe("PATCH /api/preferences/favorite-workspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null, authError: { message: "no session" } }));
    expect((await PATCH(patchRequest({ favoriteWorkspaceId: "forge" }))).status).toBe(401);
  });

  it("saves a valid workspace id", async () => {
    const supabase = fakeSupabase({});
    mocks.createClient.mockResolvedValue(supabase);
    const response = await PATCH(patchRequest({ favoriteWorkspaceId: "health" }));
    expect(response.status).toBe(200);
    expect((await response.json()).favoriteWorkspaceId).toBe("health");
  });

  it("rejects an unknown workspace id", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PATCH(patchRequest({ favoriteWorkspaceId: "not-a-real-workspace" }));
    expect(response.status).toBe(400);
  });

  it("allows clearing the favorite back to null", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}));
    const response = await PATCH(patchRequest({ favoriteWorkspaceId: null }));
    expect(response.status).toBe(200);
    expect((await response.json()).favoriteWorkspaceId).toBeNull();
  });
});
