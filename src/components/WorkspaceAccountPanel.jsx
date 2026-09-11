"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signOutSafely } from "@/lib/auth/signOutSafely.js";
import { useCredentialAuth } from "@/lib/auth/useCredentialAuth.js";

const panelClassName =
  "mb-8 w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900";

// Complete account access, inline on "Choose a workspace" -- sign in, create an account, see which
// account is active, and sign out, all without navigating to /auth. Reuses exactly the same
// building blocks the rest of the app already uses for this (useCredentialAuth's shared
// sign-in/sign-up/message logic -- including the corrected, non-enumerating existing-email message
// -- and the shared signOutSafely() helper), rather than a third independent implementation.
//
// `initialUser` (the server component's own already-resolved supabase.auth.getUser() result) seeds
// state so a signed-in or signed-out visitor sees the correct panel on first paint, with no loading
// flash -- the client-side getUser() call below only exists to stay in sync with an auth change that
// happens AFTER this page loaded (a sign-in/out in another tab, a token refresh, etc.), the same
// reason WorkspaceRightRail (this app's other account-control surface) does its own check too.
export default function WorkspaceAccountPanel({ initialUser = undefined }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState(initialUser);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setUser(data.user ?? null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      // The server-computed workspace list (stats, Health/Dev authorization, saved favorite) was
      // resolved for whoever was signed in when this page last rendered -- any auth change here
      // makes that stale. router.refresh() re-runs the server component in place, so the visitor
      // never has to leave this page and come back to see their real workspaces.
      router.refresh();
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase/router are stable for this component's lifetime.
  }, []);

  const {
    email, setEmail, password, setPassword, message, authAction, authActionPending, signIn, signUp,
  } = useCredentialAuth({ supabase, emailRedirectTo: () => `${window.location.origin}/` });

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const result = await signOutSafely({ supabase, redirectTo: "/" });
    if (!result.success) {
      setSigningOut(false);
      alert(result.error.message);
    }
    // On success, signOutSafely() has already navigated away.
  }

  if (user === undefined) {
    return (
      <div data-workspace-account-panel="loading" aria-busy="true" className={panelClassName}>
        <p className="text-sm font-bold text-slate-400 dark:text-slate-500">Checking your account…</p>
      </div>
    );
  }

  if (user) {
    return (
      <div data-workspace-account-panel="signed-in" className={`${panelClassName} flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
          Signed in as <span className="font-black text-slate-950 dark:text-white">{user.email}</span>
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {signingOut ? "Signing out…" : "Sign Out"}
        </button>
      </div>
    );
  }

  return (
    <div data-workspace-account-panel="signed-out" className={panelClassName}>
      <p className="mb-3 text-sm font-bold text-slate-600 dark:text-slate-300">
        Sign in or create an account to see your workspaces.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <input
          type="email"
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <input
          type="password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="button"
          onClick={signIn}
          disabled={authActionPending}
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black uppercase tracking-wide text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-amber-400 dark:text-slate-950"
        >
          {authAction === "signIn" ? "Signing in…" : "Sign In"}
        </button>
        <button
          type="button"
          onClick={signUp}
          disabled={authActionPending}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {authAction === "signUp" ? "Creating account…" : "Create Account"}
        </button>
      </div>
      {message ? (
        <p role="status" className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
          {message}
        </p>
      ) : null}
    </div>
  );
}
