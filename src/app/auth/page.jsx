"use client";

import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";
import { signOutSafely } from "@/lib/auth/signOutSafely.js";
import { useCredentialAuth } from "@/lib/auth/useCredentialAuth.js";
import { useEffect, useState } from "react";

const supabase = createClient();

function currentParams() {
  return new URLSearchParams(window.location.search);
}

function nextDestination() {
  const requested = currentParams().get("next");
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/forge/financial";
}

// The URL Supabase redirects back to after a confirmation-email click or a fresh magic link. Routing
// it through this same /auth page (rather than straight to `next`) matters because only this page
// constructs a Supabase browser client, and it's that construction which auto-exchanges a `?code=`
// in the URL for a session (see createBrowserClient's detectSessionInUrl). Carrying `next` and the
// invited email along as query params lets this page redirect onward to the right destination once
// onAuthStateChange reports a session, without the borrower losing their place.
function buildAuthRedirect(invitedEmail) {
  const params = new URLSearchParams({ next: nextDestination() });
  if (invitedEmail) params.set("email", invitedEmail);
  return `${window.location.origin}/auth?${params.toString()}`;
}

export default function AuthPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState(null);

  const {
    email, setEmail,
    password, setPassword,
    message, setMessage,
    authAction, setAuthAction, authActionPending,
    signIn, signUp, resetPassword: resetPasswordViaHook,
  } = useCredentialAuth({ supabase, emailRedirectTo: () => buildAuthRedirect(invitedEmail) });

  useEffect(() => {
    const invited = currentParams().get("email")?.trim() || null;
    if (invited) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the invited email from the URL (an external store) on mount.
      setInvitedEmail(invited);
      setEmail(invited);
    }
    // setEmail is useCredentialAuth's own useState setter -- referentially stable for the life of
    // this component, same as a plain local useState setter would be; the exhaustive-deps rule just
    // can't see that through a custom hook the way it can a direct useState call in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single source of truth for leaving this page once a session exists -- covers an explicit sign-in,
  // an explicit sign-up (when email confirmation is off), and a session Supabase auto-recovers from a
  // `?code=` in the URL after the borrower clicks a confirmation link, so there is exactly one place
  // that decides "authenticated, go to `next`" instead of three imperative redirects that can drift.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) window.location.href = nextDestination();
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (authActionPending) return;
    setAuthAction("signOut");
    const result = await signOutSafely({ supabase, redirectTo: "/" });

    if (!result.success) {
      // Stay on this page, show the error, and restore the enabled state -- never claim the user was
      // signed out when they weren't.
      setAuthAction(null);
      alert(result.error.message);
    }
    // On success, signOutSafely() has already navigated away -- no need to clear authAction, this
    // component is being torn down.
  }

  function resetPassword() {
    return resetPasswordViaHook({ redirectTo: `${window.location.origin}/auth/reset-password` });
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-md mx-auto py-16 px-6">
        <div className="bg-white rounded-3xl shadow-xl p-8">
          <h1 className="text-4xl font-extrabold mb-4">Sign In</h1>

          {invitedEmail ? (
            <p role="status" className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
              You&apos;ve been invited to view a private financing account as <strong>{invitedEmail}</strong>.
              Create an account with this email if you&apos;re new, or sign in if you already have one —
              access is granted automatically once you&apos;re signed in with this address.
            </p>
          ) : (
            <p className="text-gray-600 mb-8">
              Create an account or sign in to manage your listings.
            </p>
          )}

          <input
            className="w-full truncate border rounded-xl px-4 py-4 mb-4 disabled:bg-gray-100 disabled:text-gray-600"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={Boolean(invitedEmail)}
            title={invitedEmail || undefined}
          />

          <div className="relative mb-2">
            <input
              className="w-full border rounded-xl px-4 py-4 pr-20"
              placeholder="Password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute inset-y-0 right-0 px-4 font-semibold text-blue-900"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          <button
            type="button"
            onClick={resetPassword}
            disabled={authActionPending}
            className="mb-2 text-sm font-semibold text-blue-900 underline disabled:opacity-60"
          >
            {authAction === "resetPassword" ? "Sending reset link…" : "Forgot password?"}
          </button>

          {invitedEmail ? (
            <p className="mb-6 text-xs text-gray-500">
              Password reset only works if you already have a 409 Marketplace account with this email.
              If you&apos;re new, use Create Account below instead.
            </p>
          ) : (
            <div className="mb-6" />
          )}

          {message ? (
            <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
              {message}
            </p>
          ) : null}

          <button
            onClick={signIn}
            disabled={authActionPending}
            className="w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold mb-4 disabled:opacity-60"
          >
            {authAction === "signIn" ? "Signing in…" : "Sign In"}
          </button>

          <button
            onClick={signUp}
            disabled={authActionPending}
            className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold disabled:opacity-60"
          >
            {authAction === "signUp" ? "Creating account…" : "Create Account"}
          </button>

          <button
            onClick={signOut}
            disabled={authActionPending}
            className="w-full bg-gray-800 text-white py-4 rounded-2xl text-xl font-bold mt-4 disabled:opacity-60"
          >
            {authAction === "signOut" ? "Signing out…" : "Sign Out"}
          </button>
        </div>
      </section>
    </main>
  );
}
