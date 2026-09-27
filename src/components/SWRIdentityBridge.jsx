"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setCacheIdentity } from "@/hooks/swrCache.js";

/**
 * Application-wide SWR cache identity boundary. Mounted once in the root layout,
 * above every page, so every authenticated SWR consumer gets disk persistence --
 * not just pages that happen to mount an account panel.
 *
 * The server layout resolves the signed-in user from cookies and passes
 * `initialUserId`; it is applied synchronously during the first render (ref-guarded,
 * so it runs before any child's disk hydration), then the auth subscription keeps
 * it current across sign-in/out, session expiration, and account switches.
 * setCacheIdentity() propagates identity changes to existing consumers through
 * subscriber notification; until an identity is set, the disk stays fail-closed
 * and the cache works memory-only.
 */
export default function SWRIdentityBridge({ initialUserId = null }) {
  const [supabase] = useState(() => createClient());
  // Runs before children mount/hydrate: the first paint can already read disk.
  // No subscribers exist yet on first mount, so the notify inside is a no-op.
  const appliedInitialIdentity = useRef(null);
  if (appliedInitialIdentity.current == null) {
    appliedInitialIdentity.current = initialUserId ?? null;
    setCacheIdentity(initialUserId ?? null);
  }

  useEffect(() => {
    setCacheIdentity(initialUserId ?? null);
  }, [initialUserId]);

  useEffect(() => {
    // INITIAL_SESSION fires immediately on subscribe, covering sessions the
    // server didn't see; later events cover sign-in/out, expiry, and switches.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setCacheIdentity(session?.user?.id ?? null);
    });
    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  return null;
}
