"use client";

import { useCallback, useState } from "react";
import {
  deleteChartProjectDocument,
  listChartProjectDocuments,
  loadChartProjectDocument,
  saveChartProjectDocument,
} from "@/domains/chartBuilder/chartProjectAdapter.js";

function readSavedStore(pid) {
  try {
    return {
      entries: listChartProjectDocuments(pid == null ? {} : { projectId: pid }),
      error: null,
    };
  } catch (error) {
    return {
      entries: [],
      error: error instanceof Error ? error.message : "Could not read saved charts.",
    };
  }
}

// Save / open / delete controls for browser-local chart persistence
// (slice 4.1). Everything stays in the browser's localStorage — no server,
// no uploads. Loading a chart hands a fresh ChartDocument to onLoad; the
// page is responsible for starting a new undo stack from it.
export default function ChartPersistenceControls({
  doc,
  projectId = null,
  onLoad,
  onNotice,
}) {
  const [title, setTitle] = useState("");
  // Lazily read once on mount (never setState inside an effect); refresh()
  // re-reads after every save/delete and each time the panel opens.
  const [store, setStore] = useState(() => readSavedStore(projectId));
  const [open, setOpen] = useState(false);
  const saved = store.entries;
  const listError = store.error;

  const refresh = useCallback(() => {
    setStore(readSavedStore(projectId));
  }, [projectId]);

  function notify(text, kind) {
    onNotice?.({ text, kind });
  }

  function handleSave() {
    if (!doc) return;
    try {
      saveChartProjectDocument({
        projectId,
        chartDocument: doc,
        title: title.trim() || undefined,
      });
      notify("Chart saved on this device.", "info");
      setTitle("");
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save the chart.", "error");
    }
  }

  function handleOpen(documentId) {
    try {
      const loaded = loadChartProjectDocument(documentId);
      onLoad?.(loaded);
      setOpen(false);
      notify("Saved chart opened.", "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open the saved chart.", "error");
    }
  }

  function handleDelete(documentId, chartTitle) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete the saved chart "${chartTitle}"? This cannot be undone.`)
    ) {
      return;
    }
    try {
      deleteChartProjectDocument(documentId);
      notify("Saved chart deleted.", "info");
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete the saved chart.", "error");
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {doc && (
          <>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Chart name"
              aria-label="Chart name"
              className="w-36 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Save
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            refresh();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
        >
          Saved charts{saved.length > 0 ? ` (${saved.length})` : ""}
        </button>
      </div>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Saved charts</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close saved charts"
              className="rounded px-2 py-0.5 text-sm text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
          {listError ? (
            <p className="text-xs text-red-700">{listError}</p>
          ) : saved.length === 0 ? (
            <p className="text-xs text-slate-500">
              No saved charts yet. Name your chart and press Save — it stays on
              this device.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {saved.map((entry) => (
                <li
                  key={entry.documentId}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {entry.title}
                    </div>
                    <div className="text-xs text-slate-500">
                      {entry.chartType === "workflow" ? "Workflow" : "Org chart"}
                      {entry.savedAt
                        ? ` · ${new Date(entry.savedAt).toLocaleString()}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpen(entry.documentId)}
                    className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.documentId, entry.title)}
                    aria-label={`Delete ${entry.title}`}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
