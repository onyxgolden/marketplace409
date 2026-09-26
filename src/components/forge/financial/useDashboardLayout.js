"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createLayout,
  hiddenIds,
  isDefaultLayout,
  isSharedLayoutKey,
  moveCardId,
  normalizeLayout,
  visibleIds,
} from "./dashboardCardLayout.js";

function readStoredLayout(storageKey, cardIds) {
  const fallback = createLayout(cardIds);
  if (!storageKey || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return normalizeLayout(JSON.parse(raw), cardIds);
  } catch {
    return fallback;
  }
}

function writeStoredLayout(storageKey, layout) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // Private-mode / quota failures must never break the dashboard -- the
    // layout simply won't survive a reload.
  }
}

function syncMetaKey(storageKey) {
  return `${storageKey}.syncmeta`;
}

function readSyncMeta(storageKey) {
  if (!storageKey || typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(syncMetaKey(storageKey)) || "{}") || {};
  } catch {
    return {};
  }
}

function writeSyncMeta(storageKey, meta) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(syncMetaKey(storageKey), JSON.stringify(meta));
  } catch {
    // Meta loss only risks a redundant re-sync, never data loss.
  }
}

async function fetchServerLayout(syncKey) {
  const response = await fetch(`/api/preferences/dashboard-layout/${encodeURIComponent(syncKey)}`);
  if (!response.ok) return null;
  const body = await response.json().catch(() => ({}));
  if (!body?.success) return null;
  return { layout: body.layout ?? null, updatedAt: body.updatedAt ?? null };
}

async function pushServerLayout(syncKey, layout) {
  const response = await fetch(`/api/preferences/dashboard-layout/${encodeURIComponent(syncKey)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ layout }),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => ({}));
  return body?.success ? (body.updatedAt ?? new Date().toISOString()) : null;
}

// Per-user dashboard card layout.
//
// Without syncKey: persisted to localStorage only (per-browser).
// With syncKey (e.g. "financial-sections"): the arrangement additionally
// syncs across the signed-in user's devices via
// /api/preferences/dashboard-layout. localStorage stays the instant-read
// cache and offline fallback; the server is the cross-device source of
// truth, last-write-wins by updated_at.
//
// Every mutation writes immediately -- there is no save button to forget.
// Server pushes are debounced so rapid reorder taps produce one request.
//
// storageKey may change once (null/"shared" -> user-scoped) after the page
// resolves the acting user; the hook re-reads the stored layout on key
// change so a signed-in user's saved layout wins over the anonymous one.
export function useDashboardLayout(storageKey, cardIds, syncKey = null) {
  const [layout, setLayout] = useState(() => createLayout(cardIds));
  const keyRef = useRef(storageKey);
  const syncKeyRef = useRef(syncKey);
  // cardIds may be rebuilt by the caller each render -- keep the latest in a
  // ref (updated in an effect, never during render) instead of an effect dep
  // so the storage re-read only fires when the key itself changes.
  const cardIdsRef = useRef(cardIds);
  useEffect(() => {
    cardIdsRef.current = cardIds;
  });
  const pushTimerRef = useRef(null);
  const pendingPushRef = useRef(null);
  // Generation counter: incremented on every local mutation. The initial
  // server GET captures the generation when it starts; if a mutation lands
  // while the GET is in flight, the response handler must not overwrite it
  // with the stale pre-fetch snapshot.
  const mutationGenRef = useRef(0);

  const flushPendingPush = useCallback(() => {
    const pending = pendingPushRef.current;
    const key = syncKeyRef.current;
    const storage = keyRef.current;
    if (!pending || !key || isSharedLayoutKey(storage)) return;
    pendingPushRef.current = null;
    if (pushTimerRef.current) {
      clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    // keepalive lets the request survive tab close (pagehide).
    fetch(`/api/preferences/dashboard-layout/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: pending }),
      keepalive: true,
    })
      .then((response) => (response.ok ? response.json().catch(() => ({})) : null))
      .then((body) => {
        if (body?.success && body.updatedAt) {
          writeSyncMeta(storage, { ...readSyncMeta(storage), lastPushAt: body.updatedAt });
        }
      })
      .catch(() => {
        // Tab is closing; the localStorage copy already has the layout and
        // the next load will retry the push.
      });
  }, []);

  const pushToServer = useCallback((nextLayout) => {
    const key = syncKeyRef.current;
    const storage = keyRef.current;
    if (!key || isSharedLayoutKey(storage)) return;
    pendingPushRef.current = nextLayout;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(async () => {
      pushTimerRef.current = null;
      pendingPushRef.current = null;
      const pushedAt = await pushServerLayout(key, nextLayout).catch(() => null);
      // Only record the push when the server confirms it: a failed push
      // leaves lastPushAt stale so the next load re-pushes our local
      // arrangement instead of letting an older server copy win.
      if (pushedAt) writeSyncMeta(storage, { ...readSyncMeta(storage), lastPushAt: pushedAt });
    }, 800);
  }, []);

  useEffect(() => {
    keyRef.current = storageKey;
    syncKeyRef.current = syncKey;
    const ids = cardIdsRef.current;
    const local = readStoredLayout(storageKey, ids);
    setLayout(local);
    // Cross-device sync: adopt the server's arrangement when it is newer
    // than anything this device has pushed. Runs only for signed-in users
    // (never the shared pre-identity fallback).
    if (syncKey && !isSharedLayoutKey(storageKey)) {
      let cancelled = false;
      const genAtFetch = mutationGenRef.current;
      fetchServerLayout(syncKey)
        .then((server) => {
          if (cancelled || !server) return;
          // A mutation may have landed while the GET was in flight. Compare
          // against the CURRENT local arrangement, not the snapshot taken
          // when the request started -- otherwise the server copy would
          // silently replace the user's just-made change.
          const mutatedDuringFetch = mutationGenRef.current !== genAtFetch;
          const currentLocal = mutatedDuringFetch
            ? readStoredLayout(storageKey, ids)
            : local;
          const meta = readSyncMeta(storageKey);
          const serverNewer = server.updatedAt && (!meta.lastPushAt || server.updatedAt > meta.lastPushAt);
          if (server.layout) {
            if (mutatedDuringFetch) {
              // The user's in-flight change wins over whatever the server
              // returned; push it up so other devices converge on it.
              pushToServer(currentLocal);
            } else if (isDefaultLayout(local, ids) || serverNewer) {
              const normalized = normalizeLayout(server.layout, ids);
              setLayout(normalized);
              writeStoredLayout(storageKey, normalized);
            } else {
              // Our local arrangement is newer than the server's -- push it
              // up so the other devices converge on it.
              pushToServer(local);
            }
          } else if (!isDefaultLayout(currentLocal, ids)) {
            // First sync: this device has a customized arrangement the
            // server has never seen -- adopt it as the cross-device layout.
            pushToServer(currentLocal);
          }
        })
        .catch(() => {
          // Offline or server hiccup: the localStorage copy keeps working;
          // sync resumes on the next load.
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [storageKey, syncKey, pushToServer]);

  // Flush any debounced server push when the tab is being hidden/closed, so
  // a mutation made just before close still reaches the server and other
  // devices. The localStorage write already happened synchronously in
  // `apply`, so this device never loses the layout even if the flush fails.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPageHide = () => flushPendingPush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [flushPendingPush]);

  const apply = useCallback((produce) => {
    mutationGenRef.current += 1;
    setLayout((current) => {
      const next = produce(current);
      // Never persist to the shared fallback key: it exists only while the
      // acting user is still resolving, and writing there would let one
      // session mutate the fallback layout another session reads. The
      // in-memory layout still updates, so the UI responds immediately.
      if (!isSharedLayoutKey(keyRef.current)) {
        // localStorage writes are idempotent, so double-invoked updaters
        // (React StrictMode) are harmless.
        writeStoredLayout(keyRef.current, next);
        pushToServer(next);
      }
      return next;
    });
  }, [pushToServer]);

  const moveUp = useCallback(
    (cardId) =>
      apply((current) => ({
        ...current,
        order: moveCardId(current.order, current.hidden, cardId, -1),
      })),
    [apply],
  );

  const moveDown = useCallback(
    (cardId) =>
      apply((current) => ({
        ...current,
        order: moveCardId(current.order, current.hidden, cardId, 1),
      })),
    [apply],
  );

  const hideCard = useCallback(
    (cardId) =>
      apply((current) =>
        current.hidden.includes(cardId)
          ? current
          : { ...current, hidden: [...current.hidden, cardId] },
      ),
    [apply],
  );

  const showCard = useCallback(
    (cardId) =>
      apply((current) => ({
        ...current,
        hidden: current.hidden.filter((id) => id !== cardId),
      })),
    [apply],
  );

  const showAllCards = useCallback(
    () => apply((current) => ({ ...current, hidden: [] })),
    [apply],
  );

  const resetLayout = useCallback(
    () => apply(() => createLayout(cardIdsRef.current)),
    [apply],
  );

  return {
    layout,
    visibleCardIds: visibleIds(layout),
    hiddenCardIds: hiddenIds(layout),
    isCustomized: !isDefaultLayout(layout, cardIds),
    moveUp,
    moveDown,
    hideCard,
    showCard,
    showAllCards,
    resetLayout,
  };
}
