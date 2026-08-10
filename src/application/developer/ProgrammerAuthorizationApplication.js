export const DEFAULT_PROGRAMMER_EMAIL =
  "jasonmorgan99@gmail.com";

function normalizeEmail(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

export class ProgrammerAuthorizationApplication {
  constructor({
    supabase,
    allowedEmail =
      process.env.FORGE_PROGRAMMER_EMAIL ||
      DEFAULT_PROGRAMMER_EMAIL,
  } = {}) {
    this.supabase = supabase;
    this.allowedEmail =
      normalizeEmail(allowedEmail);
  }

  async loadAuthorization() {
    if (!this.supabase?.auth?.getUser) {
      return Object.freeze({
        ok: false,
        authorized: false,
        user: null,
        message:
          "Programmer authentication is unavailable.",
      });
    }

    const {
      data,
      error,
    } =
      await this.supabase.auth.getUser();

    if (error) {
      return Object.freeze({
        ok: false,
        authorized: false,
        user: null,
        message:
          error.message ||
          "Could not verify programmer authorization.",
      });
    }

    const user =
      data?.user || null;

    const authorized =
      Boolean(user) &&
      normalizeEmail(user.email) ===
        this.allowedEmail;

    return Object.freeze({
      ok: true,
      authorized,
      user,
    });
  }
}

Object.freeze(
  ProgrammerAuthorizationApplication,
);
