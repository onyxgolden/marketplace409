"use client";

import { useState } from "react";

// Deliberately the SAME response regardless of whether this email is new, already confirmed, or
// already registered-but-unconfirmed -- showing a different message per case (as an earlier version
// of this fix did, checking `data.user.identities.length`) is itself an account-enumeration oracle:
// an attacker could tell whether an email is registered just by reading which message came back.
// Supabase's own signUp() already avoids leaking this (no error, either way); the UI must not
// reintroduce the leak on top of it. This one message safely covers all three cases by telling the
// legitimate owner of the address what to do next without confirming which case they're in.
//
// Shared by every credential-based sign-in/sign-up surface (src/app/auth/page.jsx and the "Choose a
// workspace" account panel) so this message, and the sign-in/sign-up/reset-password behavior behind
// it, exist in exactly one place rather than risking drift between two independent reimplementations.
export const SIGNUP_SUBMITTED_MESSAGE =
  "Thanks! If this is a new email, check your inbox to confirm your account. If you already have " +
  "an account with this email, you can sign in above instead, or use \"Forgot password?\" if you " +
  "don't remember your password.";

// A single mutually-exclusive `authAction` slot, not independent booleans per action: while any one
// auth action is pending, every other one must be disabled too, not just its own button -- otherwise
// a user could start Sign In, then, while it's still in flight, also click Create Account, racing two
// Supabase auth calls against the same client/session. `authAction` being non-null makes a second
// action structurally impossible to start until the first has cleared.
export function useCredentialAuth({ supabase, emailRedirectTo, initialEmail = "" } = {}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [authAction, setAuthAction] = useState(null);
  const authActionPending = authAction !== null;

  async function signUp() {
    if (authActionPending) return;
    setMessage("");
    setAuthAction("signUp");
    // `emailRedirectTo` may be a plain string or a thunk -- a thunk lets the caller defer reading
    // browser-only values (e.g. window.location.origin) until the moment of the actual sign-up call,
    // instead of evaluating them during render, which would break server-side rendering of the
    // "use client" component that owns this hook.
    const resolvedEmailRedirectTo = typeof emailRedirectTo === "function" ? emailRedirectTo() : emailRedirectTo;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      ...(resolvedEmailRedirectTo ? { options: { emailRedirectTo: resolvedEmailRedirectTo } } : {}),
    });
    setAuthAction(null);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(SIGNUP_SUBMITTED_MESSAGE);
  }

  async function signIn() {
    if (authActionPending) return;
    setMessage("");
    setAuthAction("signIn");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthAction(null);

    if (error) {
      setMessage(error.message);
      return;
    }
    // The caller's own onAuthStateChange subscription handles what happens next (redirect, refresh,
    // etc.) once the session lands -- this hook only knows how to attempt the sign-in itself.
  }

  async function resetPassword({ redirectTo } = {}) {
    if (authActionPending) return;
    if (!email.trim()) {
      setMessage("Enter your email address first, then select Forgot password?");
      return;
    }

    setMessage("");
    setAuthAction("resetPassword");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setAuthAction(null);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Check your email for a secure password-reset link.");
  }

  return {
    email, setEmail,
    password, setPassword,
    message, setMessage,
    // authAction/setAuthAction are exposed (not just the derived authActionPending) so a caller can
    // fold a non-credential action it owns itself (e.g. sign-out) into the SAME mutual-exclusion
    // slot -- sign-in, sign-up, reset-password, and sign-out must all block each other, not just the
    // three this hook directly implements.
    authAction, setAuthAction, authActionPending,
    signIn, signUp, resetPassword,
  };
}
