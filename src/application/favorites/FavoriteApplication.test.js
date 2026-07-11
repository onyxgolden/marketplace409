import { describe, expect, it, vi } from "vitest";

import { FavoriteApplication } from "./FavoriteApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  statusData = null,
  statusError = null,
  insertData = { id: "favorite-1" },
  insertError = null,
  deleteError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));

  const maybeSingle = vi.fn(async () => ({
    data: statusData,
    error: statusError,
  }));

  const statusListingEq = vi.fn(() => ({
    maybeSingle,
  }));

  const statusUserEq = vi.fn(() => ({
    eq: statusListingEq,
  }));

  const selectStatus = vi.fn(() => ({
    eq: statusUserEq,
  }));

  const insertSingle = vi.fn(async () => ({
    data: insertData,
    error: insertError,
  }));

  const insertSelect = vi.fn(() => ({
    single: insertSingle,
  }));

  const insert = vi.fn(() => ({
    select: insertSelect,
  }));

  const deleteEq = vi.fn(async () => ({
    error: deleteError,
  }));

  const deleteFn = vi.fn(() => ({
    eq: deleteEq,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("favorites");

    return {
      select: selectStatus,
      insert,
      delete: deleteFn,
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
      selectStatus,
      statusUserEq,
      statusListingEq,
      maybeSingle,
      insert,
      insertSelect,
      insertSingle,
      deleteFn,
      deleteEq,
    },
  };
}

describe("FavoriteApplication", () => {
  it("returns an unsaved state when the user is not authenticated", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.loadFavoriteStatus({
      listingId: "listing-1",
    });

    expect(supabase.mocks.from).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: true,
      authenticated: false,
      isSaved: false,
      favoriteId: null,
    });
  });

  it("loads an existing favorite status", async () => {
    const supabase = createSupabaseMock({
      statusData: {
        id: "favorite-1",
      },
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.loadFavoriteStatus({
      listingId: "listing-1",
    });

    expect(supabase.mocks.selectStatus).toHaveBeenCalledWith("id");
    expect(supabase.mocks.statusUserEq).toHaveBeenCalledWith(
      "user_id",
      "user-1",
    );
    expect(supabase.mocks.statusListingEq).toHaveBeenCalledWith(
      "listing_id",
      "listing-1",
    );

    expect(result).toEqual({
      ok: true,
      authenticated: true,
      isSaved: true,
      favoriteId: "favorite-1",
    });
  });

  it("returns an unsaved state when no favorite exists", async () => {
    const supabase = createSupabaseMock({
      statusData: null,
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.loadFavoriteStatus({
      listingId: "listing-1",
    });

    expect(result).toEqual({
      ok: true,
      authenticated: true,
      isSaved: false,
      favoriteId: null,
    });
  });

  it("normalizes favorite status lookup errors", async () => {
    const error = new Error("Status lookup failed");

    const supabase = createSupabaseMock({
      statusError: error,
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.loadFavoriteStatus({
      listingId: "listing-1",
    });

    expect(result).toEqual({
      ok: false,
      message: "Status lookup failed",
      error,
    });
  });

  it("requires authentication before toggling a favorite", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.toggleFavorite({
      listingId: "listing-1",
      isSaved: false,
      favoriteId: null,
    });

    expect(supabase.mocks.from).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      redirectTo: "/auth",
      message: "Please sign in to save listings.",
      requiresAuthentication: true,
    });
  });

  it("creates a favorite for an authenticated user", async () => {
    const supabase = createSupabaseMock({
      insertData: {
        id: "favorite-1",
      },
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.toggleFavorite({
      listingId: "listing-1",
      isSaved: false,
      favoriteId: null,
    });

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        user_id: "user-1",
        listing_id: "listing-1",
      },
    ]);

    expect(result).toEqual({
      ok: true,
      isSaved: true,
      favoriteId: "favorite-1",
    });
  });

  it("normalizes favorite creation errors", async () => {
    const error = new Error("Insert failed");

    const supabase = createSupabaseMock({
      insertData: null,
      insertError: error,
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.toggleFavorite({
      listingId: "listing-1",
      isSaved: false,
      favoriteId: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Insert failed",
      error,
    });
  });

  it("removes an existing favorite", async () => {
    const supabase = createSupabaseMock();

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.toggleFavorite({
      listingId: "listing-1",
      isSaved: true,
      favoriteId: "favorite-1",
    });

    expect(supabase.mocks.deleteEq).toHaveBeenCalledWith(
      "id",
      "favorite-1",
    );
    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: true,
      isSaved: false,
      favoriteId: null,
    });
  });

  it("normalizes favorite removal errors", async () => {
    const error = new Error("Delete failed");

    const supabase = createSupabaseMock({
      deleteError: error,
    });

    const application = new FavoriteApplication({
      supabase,
    });

    const result = await application.toggleFavorite({
      listingId: "listing-1",
      isSaved: true,
      favoriteId: "favorite-1",
    });

    expect(result).toEqual({
      ok: false,
      message: "Delete failed",
      error,
    });
  });
});
