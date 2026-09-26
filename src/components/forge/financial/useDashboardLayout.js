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

// Per-user dashboard card layout, persisted to localStorage (no DB migration).
// Every mutation writes immediately -- there is no save button to forget.
//
// storageKey may change once (null/"shared" -> user-scoped) after the page
// resolves the acting user; the hook re-reads the stored layout on key
// change so a signed-in user's saved layout wins over the anonymous one.
export function useDashboardLayout(storageKey, cardIds) {
  const [layout, setLayout] = useState(() => createLayout(cardIds));
  const keyRef = useRef(storageKey);
  // cardIds may be rebuilt by the caller each render -- keep the latest in a
  // ref (updated in an effect, never during render) instead of an effect dep
  // so the storage re-read only fires when the key itself changes.
  const cardIdsRef = useRef(cardIds);
  useEffect(() => {
    cardIdsRef.current = cardIds;
  });

  useEffect(() => {
    keyRef.current = storageKey;
    setLayout(readStoredLayout(storageKey, cardIdsRef.current));
  }, [storageKey]);

  const apply = useCallback((produce) => {
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
      }
      return next;
    });
  }, []);

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
