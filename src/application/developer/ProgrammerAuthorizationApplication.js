// SaaS Auth PR 1 — programmer authorization by stable user-ID grant.
//
// BEFORE: an email comparison against FORGE_PROGRAMMER_EMAIL (default
// jasonmorgan99@gmail.com). Email is display/contact only and is never
// authority (owner decision D4): an attacker who controls an email
// address, or a stale env var, could pass the old check, and a
// legitimate programmer whose email changed would fail it.
//
// AFTER: forge_is_programmer() — true only when the caller's immutable
// auth.users.id holds an active forge_programmer_grants row, granted
// by a platform owner through forge_programmer_grant (audited, and
// revocable). Default: NO customer access; a grant alone still only
// unlocks read-only diagnostics, and any workspace access additionally
// needs a live, reasoned support context for that workspace.
export class ProgrammerAuthorizationApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  async loadAuthorization() {
    if (!this.supabase?.auth?.getUser) {
      return Object.freeze({
        ok: false,
        authorized: false,
        user: null,
        message: "Programmer authentication is unavailable.",
      });
    }

    const { data, error } = await this.supabase.auth.getUser();

    if (error) {
      return Object.freeze({
        ok: false,
        authorized: false,
        user: null,
        message: error.message || "Could not verify programmer authorization.",
      });
    }

    const user = data?.user || null;

    if (!user) {
      return Object.freeze({
        ok: true,
        authorized: false,
        user: null,
      });
    }

    if (typeof this.supabase.rpc !== "function") {
      return Object.freeze({
        ok: false,
        authorized: false,
        user,
        message: "Programmer authorization check is unavailable.",
      });
    }

    const { data: isProgrammer, error: rpcError } = await this.supabase.rpc(
      "forge_is_programmer",
    );

    if (rpcError) {
      return Object.freeze({
        ok: false,
        authorized: false,
        user,
        message: "Could not verify programmer authorization.",
      });
    }

    return Object.freeze({
      ok: true,
      authorized: isProgrammer === true,
      user,
    });
  }
}

Object.freeze(ProgrammerAuthorizationApplication);
