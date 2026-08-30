import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { createAuthenticatedPrivateFinancingApplication } from "./createAuthenticatedPrivateFinancingApplication";

function stubOwnerLookup(data) {
  return {
    select: vi.fn(function select() {
      return this;
    }),
    eq: vi.fn(function eq() {
      return this;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

describe("createAuthenticatedPrivateFinancingApplication", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authenticated user's own id as effectiveOwnerId when they have no active co_owner membership", async () => {
    const user = { id: "owner-1" };
    const supabaseClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
      from: vi.fn(() => stubOwnerLookup(null)),
    };
    mocks.createClient.mockResolvedValue(supabaseClient);

    const result = await createAuthenticatedPrivateFinancingApplication();

    expect(result.response).toBeUndefined();
    expect(result.user).toBe(user);
    expect(result.effectiveOwnerId).toBe("owner-1");
    expect(result.supabaseClient).toBe(supabaseClient);
  });

  it("resolves effectiveOwnerId to the workspace owner when acting as an active co-owner", async () => {
    const user = { id: "co-owner-uuid" };
    const supabaseClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
      from: vi.fn(() => stubOwnerLookup({ owner_id: "primary-owner-uuid" })),
    };
    mocks.createClient.mockResolvedValue(supabaseClient);

    const result = await createAuthenticatedPrivateFinancingApplication();

    expect(result.effectiveOwnerId).toBe("primary-owner-uuid");
  });

  it("returns 401 when no authenticated user exists", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });

    const result = await createAuthenticatedPrivateFinancingApplication();

    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({ error: "Authenticated owner id is required." });
  });

  it("returns 401 when authentication errors", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("unavailable") }) },
    });

    const result = await createAuthenticatedPrivateFinancingApplication();

    expect(result.response.status).toBe(401);
  });
});
