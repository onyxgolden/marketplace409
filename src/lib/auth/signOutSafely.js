// Shared sign-out behavior for every FORGE entry point that can sign a user out
// (src/app/auth/page.jsx, src/components/forge/ForgeNavigationBar.jsx). Centralized so the
// clear-cache-before-redirect ordering and failure handling can't drift between call sites --
// each caller previously reimplemented this independently.
//
// Repository evidence for what "user-specific browser cache" actually means here: a search across
// every sessionStorage/localStorage/IndexedDB usage in src/ found exactly one cache of genuinely
// fetched, per-owner financial data -- src/app/forge/financial/dashboardCache.js's IndexedDB-backed
// Financial Overview cache. Every other localStorage usage found (property-panel "show guidance"
// dismissal flags, rental nav/sidebar collapse state, a report favorites list, scheduling palette
// collapse state) is a device-level UI preference, not fetched user data, and is intentionally left
// alone -- clearing those on sign-out would just be a worse experience for the next sign-in on the
// same device, with no privacy benefit, since none of them hold another user's actual data.
//
// On success: clear the identified cache(s), THEN redirect -- never redirect first and clean up
// after, since a slow/aborted cleanup after navigation starts could leave stale cached data behind
// for whoever uses this tab/browser next.
// On failure: never navigate, never claim success -- return the error so the caller can restore its
// own enabled state and show it, using whichever display mechanism is appropriate for that caller.

import { clearDashboardCache } from "@/app/forge/financial/dashboardCache.js";

export async function signOutSafely({ supabase, redirectTo = "/" }) {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { success: false, error };
  }

  // Wipes every cached Financial FORGE dashboard entry in this browser, for every
  // (actingUserId, canonicalWorkspaceId) pair it ever held -- not just whoever happened to just
  // sign out -- so a shared device never keeps showing anyone's cached financial data after any
  // sign-out. No identity needed to call this; see dashboardCache.js.
  await clearDashboardCache();
  window.location.href = redirectTo;
  return { success: true, error: null };
}
