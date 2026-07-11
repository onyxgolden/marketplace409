export class SavedListingsApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  async loadSavedListings() {
    const {
      data: { user },
      error: authenticationError,
    } = await this.supabase.auth.getUser();

    if (authenticationError) {
      return Object.freeze({
        ok: false,
        message:
          authenticationError.message ||
          "Could not verify your account.",
        error: authenticationError,
      });
    }

    if (!user) {
      return Object.freeze({
        ok: false,
        redirectTo: "/auth",
        message: "Please sign in to view saved listings.",
        requiresAuthentication: true,
      });
    }

    const { data, error } = await this.supabase
      .from("favorites")
      .select("id, listings(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return Object.freeze({
        ok: false,
        message: error.message || "Could not load saved listings.",
        error,
      });
    }

    const favorites = Object.freeze([...(data || [])]);

    return Object.freeze({
      ok: true,
      favorites,
    });
  }

  async removeSavedListing({ favoriteId }) {
    const {
      data: { user },
      error: authenticationError,
    } = await this.supabase.auth.getUser();

    if (authenticationError) {
      return Object.freeze({
        ok: false,
        message:
          authenticationError.message ||
          "Could not verify your account.",
        error: authenticationError,
      });
    }

    if (!user) {
      return Object.freeze({
        ok: false,
        redirectTo: "/auth",
        message: "Please sign in to manage saved listings.",
        requiresAuthentication: true,
      });
    }

    const { error } = await this.supabase
      .from("favorites")
      .delete()
      .eq("id", favoriteId)
      .eq("user_id", user.id);

    if (error) {
      return Object.freeze({
        ok: false,
        message: error.message || "Could not remove saved listing.",
        error,
      });
    }

    return Object.freeze({
      ok: true,
      favoriteId,
      message: "Saved listing removed.",
    });
  }
}

Object.freeze(SavedListingsApplication);
