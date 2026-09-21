"use client";

// FORGE Chart Builder — column mapping confirmation (slice 3.2).
//
// The mapping UX contract, enforced in UI:
// - Header detection only SUGGESTS. Every select starts unmapped.
// - The user must explicitly pick each mapping — "Use suggestion" buttons
//   count as an explicit choice, but nothing is ever pre-filled.
// - Continue is blocked while required targets are missing or any ambiguous
//   header is unresolved (even "leave unmapped" must be an explicit choice).

import { useMemo, useState } from "react";
import {
  REQUIRED_TARGETS,
  detectHeaders,
  targetsForMode,
  validateConfirmedMappings,
} from "@/domains/chartBuilder";

function targetLabel(target) {
  return target
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
}

export default function ColumnMappingStep({ rawTable, mode, onConfirm, onBack }) {
  const analysis = useMemo(() => detectHeaders(rawTable), [rawTable]);
  const targets = useMemo(() => targetsForMode(mode), [mode]);
  const required = REQUIRED_TARGETS[mode] ?? [];
  const [confirmed, setConfirmed] = useState([]);

  function setMapping(headerIndex, target) {
    setConfirmed((prev) => {
      const rest = prev.filter((m) => m.headerIndex !== headerIndex);
      if (!target) return rest;
      return [...rest, { headerIndex, target }];
    });
  }

  function currentTarget(headerIndex) {
    return confirmed.find((m) => m.headerIndex === headerIndex)?.target ?? "";
  }

  const gate = validateConfirmedMappings(mode, analysis, confirmed);
  const optionalTargets = targets.filter((t) => !required.includes(t));

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Confirm column mapping</h2>
      <p className="mt-1 text-sm text-slate-600">
        Match each column to what it means. Suggestions are hints only — pick
        each one yourself before continuing.
        {mode === "workflow" && (
          <span className="mt-1 block">
            A Next Step cell can list several steps separated by commas or
            semicolons — each becomes its own connection.
          </span>
        )}
      </p>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Required:{" "}
        {required.map((t) => (
          <span
            key={t}
            className={`mr-1 rounded-full px-2 py-0.5 font-semibold ${
              gate.missing.includes(t) ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {gate.missing.includes(t) ? "✗" : "✓"} {targetLabel(t)}
          </span>
        ))}
        <span className="ml-1 text-slate-500">
          Optional: {optionalTargets.map(targetLabel).join(", ") || "none"}
        </span>
      </div>

      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
        {analysis.candidates.map((candidate) => {
          const value = currentTarget(candidate.index);
          const suggestion = candidate.suggestions[0];
          return (
            <div
              key={candidate.index}
              className={`rounded-xl border p-3 ${
                candidate.ambiguous ? "border-amber-300 bg-amber-50/50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                  {candidate.header}
                </span>
                {candidate.ambiguous && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    Needs your choice
                  </span>
                )}
              </div>
              {suggestion && !value && (
                <p className="mt-1 text-xs text-slate-500">
                  Suggests: <span className="font-medium">{targetLabel(suggestion.target)}</span>
                  {candidate.suggestions.length > 1 && (
                    <> (also: {candidate.suggestions.slice(1).map((s) => targetLabel(s.target)).join(", ")})</>
                  )}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Map column ${candidate.header}`}
                  value={value}
                  onChange={(e) => setMapping(candidate.index, e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">— Leave unmapped —</option>
                  {targets.map((t) => (
                    <option key={t} value={t}>
                      {targetLabel(t)}
                    </option>
                  ))}
                </select>
                {suggestion && !value && (
                  <button
                    type="button"
                    onClick={() => setMapping(candidate.index, suggestion.target)}
                    className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Use suggestion: {targetLabel(suggestion.target)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!gate.complete && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {gate.missing.length > 0 && (
            <p>Still required: {gate.missing.map(targetLabel).join(", ")}.</p>
          )}
          {gate.ambiguousUnresolved.length > 0 && (
            <p>
              Ambiguous — please choose explicitly:{" "}
              {gate.ambiguousUnresolved.join(", ")}.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-between">
        <button
          type="button"
          className="text-sm font-medium text-slate-500 hover:underline"
          onClick={onBack}
        >
          ← Back
        </button>
        <button
          type="button"
          disabled={!gate.complete}
          onClick={() => onConfirm(confirmed)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Preview import
        </button>
      </div>
    </div>
  );
}
