"use client";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import {
  fetchWithDedupe,
  getCacheEntry,
  getIdentityEpoch,
  invalidate,
  isFresh,
  isInflight,
  patchCacheEntry,
  subscribe,
} from "./swrCache";
import {
  getSWRHydrationServerSnapshot,
  getSWRHydrationSnapshot,
  subscribeSWRHydration,
} from "./swrHydration";

/**
 * useStaleWhileRevalidate(key, fetcher, options)
 *
 * - Serves the cached payload for `key` synchronously on mount -- switching back
 *   to a recently viewed property/tenant renders instantly, no "Loading…" flash --
 *   but only after the root app has hydrated (see the hydration boundary below).
 *   The first render (server and first hydration) is always the loading state,
 *   so it can never mismatch the server HTML (React #418).
 * - Revalidates in the background when the entry is missing or older than ttlMs.
 * - `refresh()` re-fetches on demand while keeping the old data on screen.
 * - Failed refreshes keep the last good data and surface `error` alongside it.
 * - Concurrent mounts for the same key share one network request.
 *
 * Returns { data, error, isLoading, isRefreshing, refresh }.
 * `isLoading` is true only when there is nothing to show yet; `isRefreshing`
 * means stale data is on screen while a fetch is in flight.
 */
export function useStaleWhileRevalidate(key, fetcher, options = {}) {
  const { ttlMs = 30000 } = options;
  // Hydration boundary (React #418): until the root bridge marks the app
  // hydrated, the first client render must match the server's loading state --
  // the server has no disk entry, so a browser-only persisted entry must not
  // become visible during hydration. After the root commits, readiness is
  // true app-wide and warm cache-on-remount works as before (no per-hook
  // mount gate, so client-side navigation keeps its instant switch-back).
  const hydrationReady = useSyncExternalStore(
    subscribeSWRHydration,
    getSWRHydrationSnapshot,
    getSWRHydrationServerSnapshot,
  );
  const fetcherRef = useRef(fetcher);
  // Keep the ref current without reading/writing it during render. This effect
  // is declared before the fetch effect so the ref is fresh before any fetch.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const [, forceUpdate] = useReducer((value) => value + 1, 0);
  // Identity epoch: bumped by setCacheIdentity()/clearSWRCache() whenever the
  // cache is wiped for another identity. It rides in the fetch effect's deps so
  // an identity change re-triggers the fetch even though key/ttl are unchanged --
  // otherwise a mounted consumer would sit in loading state forever after an
  // account switch. The setter bails out when the epoch is unchanged, so normal
  // data/error notifications never cause a duplicate fetch.
  const [identityTick, setIdentityTick] = useState(() => getIdentityEpoch());

  useEffect(() => {
    if (key == null) return undefined;
    return subscribe(key, () => {
      const epoch = getIdentityEpoch();
      setIdentityTick((prev) => (prev === epoch ? prev : epoch));
      forceUpdate();
    });
  }, [key]);

  useEffect(() => {
    if (key == null) return undefined;
    if (!getCacheEntry(key) || !isFresh(key, ttlMs)) {
      // Errors are surfaced through the cache entry; never an unhandled rejection.
      fetchWithDedupe(key, () => fetcherRef.current()).catch(() => {});
    }
    return undefined;
  }, [key, ttlMs, identityTick]);

  // Before hydration is ready, never read the cache during render: the entry
  // stays undefined, so the hook returns the SSR-equivalent contract
  // (data null, error "", isLoading when a key exists, not refreshing). A
  // fetch or notification that completes before readiness must not make
  // cached data visible before the boundary -- it becomes visible only once
  // the bridge marks hydration and this subscription re-renders the hook.
  const entry = !hydrationReady || key == null ? undefined : getCacheEntry(key);

  const refresh = useCallback(() => {
    if (key == null) return Promise.resolve(null);
    return fetchWithDedupe(key, () => fetcherRef.current()).catch(() => null);
  }, [key]);

  const invalidateKey = useCallback(() => {
    if (key != null) invalidate(key);
  }, [key]);

  // Row-only reconciliation: patch the cached payload without a refetch.
  // Returns false when there is no entry to patch (caller falls back to a
  // targeted refresh of this same key — never the monolith).
  const mutate = useCallback((updater) => {
    if (key == null) return false;
    return patchCacheEntry(key, updater);
  }, [key]);

  return {
    data: entry?.data ?? null,
    error: entry?.error ?? "",
    isLoading: key != null && !entry,
    isRefreshing: key != null && !!entry && isInflight(key),
    // The identity epoch backing this data. Consumers that keep derived state
    // (like the Today's Priorities session) watch it to reset when the account
    // switches -- the cache is wiped and refetched for the new identity, but
    // derived state would otherwise keep showing the previous identity.
    identityEpoch: identityTick,
    refresh,
    invalidate: invalidateKey,
    mutate,
  };
}

export default useStaleWhileRevalidate;
