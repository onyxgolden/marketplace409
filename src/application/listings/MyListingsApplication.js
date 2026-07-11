export class MyListingsApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  async loadMyListings() {
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
        message: "Please sign in to view your listings.",
        requiresAuthentication: true,
      });
    }

    const { data, error } = await this.supabase
      .from("listings")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return Object.freeze({
        ok: false,
        message: error.message || "Could not load your listings.",
        error,
      });
    }

    const listings = Object.freeze([...(data || [])]);

    return Object.freeze({
      ok: true,
      listings,
    });
  }
}

Object.freeze(MyListingsApplication);
