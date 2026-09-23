"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  fetchWithDedupe,
  getCacheEntry,
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

  useEffect(() => {
    if (key == null) return undefined;
    return subscribe(key, forceUpdate);
  }, [key]);

  useEffect(() => {
    if (key == null) return undefined;
    if (!getCacheEntry(key) || !isFresh(key, ttlMs)) {
      // Errors are surfaced through the cache entry; never an unhandled rejection.
      fetchWithDedupe(key, () => fetcherRef.current()).catch(() => {});
    }
    return undefined;
  }, [key, ttlMs]);

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
    refresh,
    invalidate: invalidateKey,
  };
}

export default useStaleWhileRevalidate;
