import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { requireBrainOwner } from "../requireBrainOwner.js";

function chainable(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
  };
  return builder;
}

function fakeSupabase({ user, membership = null }) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: user ? null : { message: "no session" } }) },
    from: vi.fn(() => chainable({ data: membership, error: null })),
  };
}

describe("requireBrainOwner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a 401 response object when signed out", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: null }));
    const result = await requireBrainOwner();
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).error).toBe("Please sign in to use the Brain.");
  });

  it("resolves into the workspace owner's id for an active member", async () => {
    mocks.createClient.mockResolvedValue(
      fakeSupabase({ user: { id: "member-1" }, membership: { owner_id: "owner-9" } }),
    );
    const result = await requireBrainOwner();
    expect(result.ownerId).toBe("owner-9");
    expect(result.user.id).toBe("member-1");
    expect(result.store).toBeDefined();
    expect(typeof result.store.listSemanticEntries).toBe("function");
  });

  it("falls back to the actor's own id with no active membership", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ user: { id: "owner-1" }, membership: null }));
    const result = await requireBrainOwner();
    expect(result.ownerId).toBe("owner-1");
  });
});
