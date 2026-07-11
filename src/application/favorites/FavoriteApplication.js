export class FavoriteApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  async loadFavoriteStatus({ listingId }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: true,
        authenticated: false,
        isSaved: false,
        favoriteId: null,
      };
    }

    const { data, error } = await this.supabase
      .from("favorites")
      .select("id")
      .eq("user_id", user.id)
      .eq("listing_id", listingId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        message: error.message || "Could not check saved listing status.",
        error,
      };
    }

    return {
      ok: true,
      authenticated: true,
      isSaved: Boolean(data),
      favoriteId: data?.id || null,
    };
  }

  async toggleFavorite({
    listingId,
    isSaved,
    favoriteId,
  }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        redirectTo: "/auth",
        message: "Please sign in to save listings.",
        requiresAuthentication: true,
      };
    }

    if (isSaved) {
      const { error } = await this.supabase
        .from("favorites")
        .delete()
        .eq("id", favoriteId);

      if (error) {
        return {
          ok: false,
          message: error.message || "Could not remove saved listing.",
          error,
        };
      }

      return {
        ok: true,
        isSaved: false,
        favoriteId: null,
      };
    }

    const { data, error } = await this.supabase
      .from("favorites")
      .insert([
        {
          user_id: user.id,
          listing_id: listingId,
        },
      ])
      .select()
      .single();

    if (error || !data) {
      return {
        ok: false,
        message: error?.message || "Could not save listing.",
        error,
      };
    }

    return {
      ok: true,
      isSaved: true,
      favoriteId: data.id,
    };
  }
}

Object.freeze(FavoriteApplication);
