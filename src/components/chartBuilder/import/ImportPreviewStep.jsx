"use client";

// FORGE Chart Builder — import preview step (slice 3.2).
//
// Shows the human-readable before-commit summary: how many people and
// reporting lines the import would create, the full issue list, and a
// per-row trace. Nothing is committed until the user presses "Import chart" —
// and that button stays disabled while any error exists.

import ImportIssuePanel from "./ImportIssuePanel.jsx";

const TRACE_LIMIT = 200;

export default function ImportPreviewStep({ preview, onCommit, onBack }) {
  const canCommit = preview.errorCount === 0;
  const shown = preview.rowTrace.slice(0, TRACE_LIMIT);
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Preview import</h2>
      <p className="mt-1 text-sm text-slate-600">
        Review what would be created. The chart is not changed until you press
        “Import chart”.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryStat value={preview.nodeCount} label="People" />
        <SummaryStat value={preview.edgeCount} label="Reporting lines" />
        <SummaryStat value={preview.warningCount} label="Warnings" tone="amber" />
        <SummaryStat value={preview.errorCount} label="Errors" tone="red" />
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Issues
        </h3>
        <div className="mt-1">
          <ImportIssuePanel issues={preview.issues} />
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Row trace
        </h3>
        <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
          {shown.map((entry) => (
            <li key={entry.rowNumber} className="flex gap-2 px-2 py-1 text-xs">
              <span className="w-14 shrink-0 font-semibold text-slate-500">
                Row {entry.rowNumber}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-900">
                <span className="font-medium">{entry.label}</span>
                <span className="text-slate-500"> — {entry.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {preview.rowTrace.length > TRACE_LIMIT && (
          <p className="mt-1 text-xs text-slate-500">
            Showing {TRACE_LIMIT} of {preview.rowTrace.length.toLocaleString()} rows.
          </p>
        )}
      </div>

      {!canCommit && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Resolve the errors above — or go back and adjust the mapping — before
          importing.
        </p>
      )}

      <div className="mt-4 flex justify-between">
        <button
          type="button"
          className="text-sm font-medium text-slate-500 hover:underline"
          onClick={onBack}
        >
          ← Back to mapping
        </button>
        <button
          type="button"
          disabled={!canCommit}
          onClick={onCommit}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Import chart
        </button>
      </div>
    </div>
  );
}

function SummaryStat({ value, label, tone }) {
  const toneClass =
    tone === "red"
      ? "text-red-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
      <p className={`text-xl font-bold ${toneClass}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
