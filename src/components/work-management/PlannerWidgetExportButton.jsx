// D5 — one Export CSV control per dashboard widget.
//
// Shared by the landing shell, the D3 scope block map, and the package
// detail dashboard. The button is purely client-side: it calls the
// supplied buildExport (a pure builder over the widget's already-rendered
// view model), downloads exactly one UTF-8 CSV file per click via a Blob
// + temporary anchor, and makes no navigation, no write, and no API call.
// A failed build (e.g. a reconciliation mismatch) downloads nothing and
// the button becomes a Retry action; the Object URL is revoked in a
// finally block on both paths. Repeated clicks while busy are ignored.
"use client";

import { useState } from "react";

export default function PlannerWidgetExportButton({
  widgetTitle,
  buildExport,
  disabled = false,
  disabledReason = "",
  onExported = null,
}) {
  const [phase, setPhase] = useState("idle"); // idle | busy | done | error

  async function handleClick() {
    if (phase === "busy" || disabled) return;
    setPhase("busy");
    let url = null;
    try {
      const { filename, csvText } = buildExport();
      // Let the busy state paint (and the button disable) before the
      // download starts, so a second click while preparing is ignored.
      await Promise.resolve();
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setPhase("done");
      if (typeof onExported === "function") onExported({ filename });
    } catch {
      setPhase("error");
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  const label = phase === "busy" ? "Preparing CSV…" : phase === "error" ? "Retry export" : "Export CSV";
  const statusText = phase === "busy"
    ? "Preparing CSV…"
    : phase === "done"
      ? "CSV downloaded"
      : phase === "error"
        ? "Export failed — retry"
        : "";

  return (
    <span className="inline-flex min-h-11 flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        aria-label={`Export ${widgetTitle} as CSV`}
        title={disabled && disabledReason ? disabledReason : `Export ${widgetTitle} as CSV`}
        disabled={disabled || phase === "busy"}
        onClick={handleClick}
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 3a1 1 0 011 1v7.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 11.586V4a1 1 0 011-1z" />
          <path d="M3 15a1 1 0 011 1v1a1 1 0 001 1h10a1 1 0 001-1v-1a1 1 0 112 0v1a3 3 0 01-3 3H5a3 3 0 01-3-3v-1a1 1 0 011-1z" />
        </svg>
        {label}
      </button>
      {disabled && disabledReason ? (
        <span className="text-xs text-slate-500 dark:text-slate-400">{disabledReason}</span>
      ) : null}
      {phase === "done" ? (
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">CSV downloaded</span>
      ) : null}
      {phase === "error" ? (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">Export failed — retry</span>
      ) : null}
      <span aria-live="polite" className="sr-only">{statusText}</span>
    </span>
  );
}
