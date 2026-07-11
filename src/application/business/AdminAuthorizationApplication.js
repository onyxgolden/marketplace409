const ADMIN_EMAIL = "jasonmorgan99@gmail.com";

function normalizeAuthenticationError(error) {
  return Object.freeze({
    ok: false,
    authorized: false,
    isAdmin: false,
    user: null,
    message:
      error?.message ||
      "Could not verify administrator authorization.",
    error,
  });
}

export class AdminAuthorizationApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  async loadAdminAuthorization() {
    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser();

    if (error) {
      return normalizeAuthenticationError(error);
    }

    const isAdmin = user?.email === ADMIN_EMAIL;

    return Object.freeze({
      ok: true,
      authorized: isAdmin,
      isAdmin,
      user: user || null,
    });
  }
}

Object.freeze(AdminAuthorizationApplication);
