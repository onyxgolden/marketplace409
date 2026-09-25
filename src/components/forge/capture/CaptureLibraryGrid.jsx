// FORGE Capture Rung 6 — web capture library grid ("use client").
//
// Renders the signed-in user's captures (signed URLs are minted server-side
// at read time, 1h expiry, never persisted). Recordings show a kind badge —
// the grid never loads WebM bytes. Loads once on page visit; no polling,
// no background refresh.
"use client";

import { useEffect, useRef, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import {
  ForgeEmptyState,
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";
import {
  TITLE_MAX,
  deleteCapture,
  fetchLibraryItems,
  freshSignedUrlFor,
  isVideoItem,
  renameCapture,
} from "@/lib/capture/libraryClient";

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCapturedAt(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function kindLabel(item) {
  return isVideoItem(item) ? "Recording" : "Screenshot";
}

export default function CaptureLibraryGrid({ highlightId = null }) {
  // Library items: stale-while-revalidate over the libraryClient wrapper (not
  // raw fetch -- libraryClient.js itself is untouched). A revisit renders the
  // cached grid instantly; a refresh never blanks it.
  const {
    data: cachedItems,
    error: loadError,
    isLoading,
    isRefreshing,
    refresh,
  } = useStaleWhileRevalidate("capture:library-items", fetchLibraryItems, { ttlMs: 60_000 });
  // Optimistic overlay for rename/delete: applied locally for instant
  // feedback, and keyed to the cached payload's identity -- once a refresh
  // resolves with fresh server data the identity changes and the overlay is
  // ignored automatically (no effect needed).
  const [overlay, setOverlay] = useState(null); // { base, items }
  const items = (overlay && overlay.base === cachedItems ? overlay.items : cachedItems) ?? null; // null = loading
  const error = loadError;
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  const cardRefs = useRef({});

  useEffect(() => {
    if (highlightId && items && items.length > 0) {
      const card = cardRefs.current[highlightId];
      if (card && typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [highlightId, items]);

  const startRename = (item) => {
    setRenamingId(item.id);
    setRenameValue(item.title || "");
    setNotice("");
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const saveRename = async (item) => {
    const clean = renameValue.trim();
    if (!clean) {
      setNotice("A non-empty title is required.");
      return;
    }
    setBusyId(item.id);
    setNotice("");
    try {
      const title = await renameCapture(item.id, clean);
      setOverlay({ base: cachedItems, items: ((overlay && overlay.base === cachedItems ? overlay.items : cachedItems) || []).map((entry) => (entry.id === item.id ? { ...entry, title } : entry)) });
      cancelRename();
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to rename the capture.");
    } finally {
      setBusyId(null);
    }
  };

  const onDownload = async (item) => {
    setBusyId(item.id);
    setNotice("");
    try {
      const url = await freshSignedUrlFor(item.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to prepare the download.");
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (item) => {
    const ok = window.confirm(`Delete "${item.title || "this capture"}" from your FORGE library? This cannot be undone.`);
    if (!ok) return;
    setBusyId(item.id);
    setNotice("");
    try {
      await deleteCapture(item.id);
      setOverlay({ base: cachedItems, items: ((overlay && overlay.base === cachedItems ? overlay.items : cachedItems) || []).filter((entry) => entry.id !== item.id) });
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to delete the capture.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-capture-library-grid>
      {notice ? (
        <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      ) : null}
      {error && items === null ? (
        <ForgeErrorState title={error} onRetry={refresh} />
      ) : null}
      {error && items !== null ? (
        <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Could not refresh — showing the last saved library.
        </p>
      ) : null}
      {isRefreshing ? (
        <p className="mb-4 text-xs font-bold text-slate-400">Updating…</p>
      ) : null}
      {items === null ? (
        <ForgeLoadingState label="Loading your library…" />
      ) : items.length === 0 && !error ? (
        <ForgeEmptyState
          headline="No captures in your FORGE library yet."
          guidance="Nothing uploads automatically. Captures are stored in your FORGE library only when you press Save to FORGE on a screenshot or recording in the FORGE Capture desktop app."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const highlighted = highlightId === item.id;
            const video = isVideoItem(item);
            return (
              <li
                key={item.id}
                ref={(el) => {
                  if (el) cardRefs.current[item.id] = el;
                  else delete cardRefs.current[item.id];
                }}
                className={`overflow-hidden rounded border bg-white shadow-sm dark:bg-slate-900 ${
                  highlighted ? "border-blue-500 ring-2 ring-blue-300" : "border-slate-200"
                }`}
              >
                <div className="flex h-44 items-center justify-center bg-slate-100 dark:bg-slate-800">
                  {video ? (
                    <span className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                      Recording · WebM
                    </span>
                  ) : (
                    // Thumbnails are short-lived signed URLs; routing them through
                    // next/image's optimizer would add per-image server cost for no benefit.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.signedUrl}
                      alt={item.title || "Screenshot"}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
                <div className="p-3">
                  {renamingId === item.id ? (
                    <div className="flex gap-2">
                      <input
                        value={renameValue}
                        maxLength={TITLE_MAX}
                        onChange={(e) => setRenameValue(e.target.value)}
                        aria-label="Capture title"
                        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => saveRename(item)}
                        className="rounded bg-blue-600 px-2 py-1 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelRename}
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={item.title}>
                      {item.title || "Untitled capture"}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {kindLabel(item)} · {formatCapturedAt(item.captured_at)}
                    {item.byte_size ? ` · ${formatBytes(item.byte_size)}` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => startRename(item)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => onDownload(item)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {busyId === item.id ? "Working…" : "Download"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => onDelete(item)}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
