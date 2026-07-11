import { describe, expect, it, vi } from "vitest";

import { MyListingsApplication } from "./MyListingsApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  authenticationError = null,
  listingsData = [],
  listingsError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
    error: authenticationError,
  }));

  const order = vi.fn(async () => ({
    data: listingsData,
    error: listingsError,
  }));

  const userEq = vi.fn(() => ({
    order,
  }));

  const select = vi.fn(() => ({
    eq: userEq,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("listings");

    return {
      select,
    };
  });

  return {
    auth: {
      getUser,
    },
    from,
    mocks: {
      getUser,
      from,
      select,
      userEq,
      order,
    },
  };
}

describe("MyListingsApplication", () => {
  it("requires authentication before loading listings", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new MyListingsApplication({
      supabase,
    });

    const result = await application.loadMyListings();

    expect(supabase.mocks.from).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      redirectTo: "/auth",
      message: "Please sign in to view your listings.",
      requiresAuthentication: true,
    });

    expect(Object.isFrozen(result)).toBe(true);
  });

  it("normalizes authentication failures", async () => {
    const authenticationError = {
      message: "Authentication failed",
    };

    const supabase = createSupabaseMock({
      authenticationError,
      user: null,
    });

    const application = new MyListingsApplication({
      supabase,
    });

    const result = await application.loadMyListings();

    expect(result).toEqual({
      ok: false,
      message: "Authentication failed",
      error: authenticationError,
    });
  });

  it("loads listings for the authenticated user", async () => {
    const listingsData = [
      {
        id: "listing-2",
        title: "Second",
      },
      {
        id: "listing-1",
        title: "First",
      },
    ];

    const supabase = createSupabaseMock({
      listingsData,
    });

    const application = new MyListingsApplication({
      supabase,
    });

    const result = await application.loadMyListings();

    expect(supabase.mocks.select).toHaveBeenCalledWith("*");
    expect(supabase.mocks.userEq).toHaveBeenCalledWith(
      "user_id",
      "user-1",
    );
    expect(supabase.mocks.order).toHaveBeenCalledWith(
      "created_at",
      {
        ascending: false,
      },
    );

    expect(result).toEqual({
      ok: true,
      listings: listingsData,
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.listings)).toBe(true);
  });

  it("normalizes an empty listing collection", async () => {
    const supabase = createSupabaseMock({
      listingsData: null,
    });

    const application = new MyListingsApplication({
      supabase,
    });

    const result = await application.loadMyListings();

    expect(result).toEqual({
      ok: true,
      listings: [],
    });
  });

  it("normalizes listing load failures", async () => {
    const listingsError = {
      message: "Load failed",
    };

    const supabase = createSupabaseMock({
      listingsError,
    });

    const application = new MyListingsApplication({
      supabase,
    });

    const result = await application.loadMyListings();

    expect(result).toEqual({
      ok: false,
      message: "Load failed",
      error: listingsError,
    });
  });
});
