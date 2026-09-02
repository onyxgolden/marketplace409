"use client";

import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";
import { clearDashboardCache } from "@/app/forge/financial/dashboardCache.js";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState(null);

  useEffect(() => {
    const invited = currentParams().get("email")?.trim() || null;
    if (invited) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the invited email from the URL (an external store) on mount.
      setInvitedEmail(invited);
      setEmail(invited);
    }
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

  async function signUp() {
    setMessage("");
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: buildAuthRedirect(invitedEmail) },
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Account created. Check your email to confirm it — you'll be brought back here and signed in automatically.");
  }

  async function signIn() {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage(error.message);
      return;
    }
    // onAuthStateChange handles the redirect to `next` once the session lands.
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
    } else {
      // sessionStorage survives a same-tab navigation -- clear the cached Financial Overview data
      // so it can't leak to whoever signs in next on this tab/browser.
      clearDashboardCache();
      window.location.href = "/";
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessage("Enter your email address first, then select Forgot password?");
      return;
    }

    setResettingPassword(true);
    setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setResettingPassword(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Check your email for a secure password-reset link.");
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
            className="w-full border rounded-xl px-4 py-4 mb-4 disabled:bg-gray-100 disabled:text-gray-600"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={Boolean(invitedEmail)}
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
            disabled={resettingPassword}
            className="mb-2 text-sm font-semibold text-blue-900 underline disabled:opacity-60"
          >
            {resettingPassword ? "Sending reset link…" : "Forgot password?"}
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
            className="w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold mb-4"
          >
            Sign In
          </button>

          <button
            onClick={signUp}
            className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold"
          >
            Create Account
          </button>

          <button
            onClick={signOut}
            className="w-full bg-gray-800 text-white py-4 rounded-2xl text-xl font-bold mt-4"
          >
            Sign Out
          </button>
        </div>
      </section>
    </main>
  );
}
