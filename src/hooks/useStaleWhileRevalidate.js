"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  fetchWithDedupe,
  getCacheEntry,
  getIdentityEpoch,
  invalidate,
  isFresh,
  isInflight,
  subscribe,
} from "./swrCache";

/**
 * useStaleWhileRevalidate(key, fetcher, options)
 *
 * - Serves the cached payload for `key` synchronously on mount — switching back
 *   to a recently viewed property/tenant renders instantly, no "Loading…" flash.
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

  const entry = key == null ? undefined : getCacheEntry(key);

  const refresh = useCallback(() => {
    if (key == null) return Promise.resolve(null);
    return fetchWithDedupe(key, () => fetcherRef.current()).catch(() => null);
  }, [key]);

  const invalidateKey = useCallback(() => {
    if (key != null) invalidate(key);
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
  };
}

export default useStaleWhileRevalidate;
