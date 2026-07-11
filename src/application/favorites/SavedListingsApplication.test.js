import { describe, expect, it, vi } from "vitest";

import { SavedListingsApplication } from "./SavedListingsApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  authenticationError = null,
  favoritesData = [],
  favoritesError = null,
  deleteError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
    error: authenticationError,
  }));

  const order = vi.fn(async () => ({
    data: favoritesData,
    error: favoritesError,
  }));

  const loadUserEq = vi.fn(() => ({
    order,
  }));

  const select = vi.fn(() => ({
    eq: loadUserEq,
  }));

  const deleteUserEq = vi.fn(async () => ({
    error: deleteError,
  }));

  const deleteFavoriteEq = vi.fn(() => ({
    eq: deleteUserEq,
  }));

  const deleteOperation = vi.fn(() => ({
    eq: deleteFavoriteEq,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("favorites");

    return {
      select,
      delete: deleteOperation,
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
      loadUserEq,
      order,
      deleteOperation,
      deleteFavoriteEq,
      deleteUserEq,
    },
  };
}

describe("SavedListingsApplication", () => {
  it("requires authentication before loading saved listings", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.loadSavedListings();

    expect(supabase.mocks.from).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      redirectTo: "/auth",
      message: "Please sign in to view saved listings.",
      requiresAuthentication: true,
    });

    expect(Object.isFrozen(result)).toBe(true);
  });

  it("normalizes authentication lookup failures while loading", async () => {
    const authenticationError = {
      message: "Authentication failed",
    };

    const supabase = createSupabaseMock({
      user: null,
      authenticationError,
    });

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.loadSavedListings();

    expect(supabase.mocks.from).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      message: "Authentication failed",
      error: authenticationError,
    });
  });

  it("loads saved listings for the authenticated user", async () => {
    const favoritesData = [
      {
        id: "favorite-2",
        listings: {
          id: "listing-2",
          title: "Second listing",
        },
      },
      {
        id: "favorite-1",
        listings: {
          id: "listing-1",
          title: "First listing",
        },
      },
    ];

    const supabase = createSupabaseMock({
      favoritesData,
    });

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.loadSavedListings();

    expect(supabase.mocks.select).toHaveBeenCalledWith(
      "id, listings(*)",
    );
    expect(supabase.mocks.loadUserEq).toHaveBeenCalledWith(
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
      favorites: favoritesData,
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.favorites)).toBe(true);
  });

  it("normalizes an empty saved-listing collection", async () => {
    const supabase = createSupabaseMock({
      favoritesData: null,
    });

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.loadSavedListings();

    expect(result).toEqual({
      ok: true,
      favorites: [],
    });

    expect(Object.isFrozen(result.favorites)).toBe(true);
  });

  it("normalizes saved-listing load failures", async () => {
    const favoritesError = {
      message: "Load failed",
    };

    const supabase = createSupabaseMock({
      favoritesError,
    });

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.loadSavedListings();

    expect(result).toEqual({
      ok: false,
      message: "Load failed",
      error: favoritesError,
    });
  });

  it("requires authentication before removing a saved listing", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.removeSavedListing({
      favoriteId: "favorite-1",
    });

    expect(supabase.mocks.from).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      redirectTo: "/auth",
      message: "Please sign in to manage saved listings.",
      requiresAuthentication: true,
    });
  });

  it("removes a saved listing owned by the authenticated user", async () => {
    const supabase = createSupabaseMock();

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.removeSavedListing({
      favoriteId: "favorite-1",
    });

    expect(supabase.mocks.deleteFavoriteEq).toHaveBeenCalledWith(
      "id",
      "favorite-1",
    );
    expect(supabase.mocks.deleteUserEq).toHaveBeenCalledWith(
      "user_id",
      "user-1",
    );

    expect(result).toEqual({
      ok: true,
      favoriteId: "favorite-1",
      message: "Saved listing removed.",
    });

    expect(Object.isFrozen(result)).toBe(true);
  });

  it("normalizes saved-listing removal failures", async () => {
    const deleteError = {
      message: "Delete failed",
    };

    const supabase = createSupabaseMock({
      deleteError,
    });

    const application = new SavedListingsApplication({
      supabase,
    });

    const result = await application.removeSavedListing({
      favoriteId: "favorite-1",
    });

    expect(result).toEqual({
      ok: false,
      message: "Delete failed",
      error: deleteError,
    });
  });
});
