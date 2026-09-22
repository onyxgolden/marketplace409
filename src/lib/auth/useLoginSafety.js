"use client";

import { useEffect } from "react";

const STORAGE_PREFIX = "forge.login-safety.recorded:";

// Stable per-session record key: user id + session expiry. The same browser
// session reports exactly once (server-side ON CONFLICT dedup is the real
// guarantee; this sessionStorage guard is just a client-side optimization so
// a second surface or a re-render doesn't fire a redundant request).
export function loginSessionRecordKey(session) {
  return `${STORAGE_PREFIX}${session.user.id}:${session.expires_at ?? "0"}`;
}

function readGuard(key) {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeGuard(key) {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // sessionStorage unavailable (private mode) -- the server dedup still
    // guarantees exactly-once recording.
  }
}

// Reports the sign-in to /api/auth/record-login exactly once per session.
// Fires on SIGNED_IN only -- never on INITIAL_SESSION or TOKEN_REFRESHED --
// so restoring an existing session never triggers a "new location" alert.
export function useLoginSafety(supabase) {
  useEffect(() => {
    if (!supabase?.auth?.onAuthStateChange) return;
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session?.user) return;
      const key = loginSessionRecordKey(session);
      if (readGuard(key)) return;
      fetch("/api/auth/record-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: key }),
      })
        .catch((error) => {
          // Alert-only: a failed record must never surface to or block the
          // user. The login itself already succeeded.
          console.error("Login safety record failed", error);
        })
        .finally(() => writeGuard(key));
    });
    return () => subscription.subscription.unsubscribe();
  }, [supabase]);
}
