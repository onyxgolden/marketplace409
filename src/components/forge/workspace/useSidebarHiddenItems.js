"use client";
import { useEffect, useState } from "react";

// Server-persisted per-user, per-sidebar hide/show state (see
// src/app/api/preferences/sidebar/[sidebarKey]/route.js and the user_sidebar_preferences table) --
// follows the same optimistic-update-with-rollback pattern as WorkspaceHubGrid's favorite-star
// toggle, just for a Set of ids instead of a single value. Shared by every ApplicationShell that
// opts into a customizable sidebar (pass a real sidebarKey); a falsy sidebarKey makes this an inert
// no-fetch, no-persist no-op -- what lets ApplicationShell call this hook unconditionally while
// leaving apps that don't pass sidebarKey (e.g. Property) completely unaffected.
export function useSidebarHiddenItems(sidebarKey) {
  const [hiddenItemIds, setHiddenItemIds] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sidebarKey) return;
    let cancelled = false;
    fetch(`/api/preferences/sidebar/${sidebarKey}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("load failed"))))
      .then((data) => { if (!cancelled) setHiddenItemIds(new Set(data.hiddenItemIds || [])); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sidebarKey]);

  async function persist(nextHiddenItemIds) {
    if (!sidebarKey) return;
    const previous = hiddenItemIds;
    setHiddenItemIds(nextHiddenItemIds);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/preferences/sidebar/${sidebarKey}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hiddenItemIds: [...nextHiddenItemIds] }),
      });
      if (!response.ok) {
        setHiddenItemIds(previous);
        setError("Unable to save your sidebar preferences. Please try again.");
      }
    } catch {
      setHiddenItemIds(previous);
      setError("Unable to save your sidebar preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggleItem(id) {
    if (!sidebarKey) return;
    const next = new Set(hiddenItemIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(next);
  }
  function showAll() {
    if (!sidebarKey) return;
    persist(new Set());
  }

  return { hiddenItemIds, saving, error, toggleItem, showAll };
}
