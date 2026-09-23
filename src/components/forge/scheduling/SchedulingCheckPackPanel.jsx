"use client";
import { useMemo, useState } from "react";
import { CHECK_FIELDS, runCheckPack } from "@/domains/scheduling/schedulingCheckPack";
import { todayISO } from "./schedulingBoardState";

// The Checks tab content for the scheduling inspector. Read-only: it consumes
// the flags produced by the check-pack domain module (which in turn consumes
// the existing DCMA functions) and never recalculates schedule quality itself.
// Selecting a check is presentation state only -- no schedule data changes.
export function SchedulingChecksPanel({ board, onClose }) {
  // Canonical data date: the board's own status/data date when the schedule
  // model carries one, otherwise todayISO() -- the existing schedule-model
  // convention for the board's data-date line (browser-local calendar date,
  // UTC-midnight anchored). The domain never reads the wall clock for
  // production schedule health; it only falls back to a local-date default for
  // direct callers that omit dataDate.
  const dataDate = board.dataDate ?? todayISO();
  const report = useMemo(
    () =>
      runCheckPack({
        blocks: (board.blocks || []).map((block) => ({
          id: block.id,
          taskCode: block.taskCode,
          label: block.label,
          blockType: block.milestone ? "milestone" : "task",
        })),
        dependencies: board.dependencies || [],
        cpmByTaskCode: board.cpm?.byTaskCode || {},
        wbsActivities: board.wbs?.activities || [],
        dataDate,
      }),
    [board, dataDate],
  );

  const needsAttention = report.checks.filter((check) => check.status === "needs_attention");
  const [selectedId, setSelectedId] = useState(null);
  const selected = report.checks.find((check) => check.id === selectedId) ?? needsAttention[0] ?? report.checks[0];

  return (
    <div className="p-6 text-slate-950" data-scheduling-checks>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
          <h2 className="mt-1 text-xl font-black">Schedule Checks</h2>
          <p className="mt-1 text-sm text-slate-500">
            The one-click check pack: the six standard schedule-health layouts, run against the data date ({report.dataDate}).
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
      </div>

      {report.totalActivities === 0 ? (
        <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-500" data-scheduling-checks-empty>
          No activities in this project yet. Add blocks to the board and the checks will run here automatically.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm font-bold text-slate-600" data-scheduling-checks-summary>
            {needsAttention.length === 0
              ? "All 6 checks clean — nothing requires attention."
              : `${needsAttention.length} of 6 checks need attention.`}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-scheduling-checks-list>
            {report.checks.map((check) => (
              <button
                key={check.id}
                type="button"
                onClick={() => setSelectedId(check.id)}
                aria-pressed={selected.id === check.id}
                data-scheduling-check={check.id}
                className={`rounded-lg border p-3 text-left ${selected.id === check.id ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <p className="text-sm font-black">{check.label}</p>
                <p className={`mt-1 text-xs font-bold ${check.status === "needs_attention" ? "text-red-700" : "text-emerald-700"}`}>
                  {check.status === "needs_attention" ? `${check.flaggedCount} to review` : "Clean"}
                </p>
              </button>
            ))}
          </div>

          {selected && (
            <div className="mt-5" data-scheduling-check-detail={selected.id}>
              <h3 className="text-lg font-black" data-scheduling-checks-active-summary>
                {selected.label} — {selected.flaggedCount === 0
                  ? "all clear"
                  : `${selected.flaggedCount} ${selected.flaggedCount === 1 ? "activity requires" : "activities require"} attention`}
              </h3>
              <p className="mt-1 text-sm text-slate-500">{selected.description}</p>
              {selected.flaggedCount === 0 ? (
                <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                  Nothing flagged under this check.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-base">
                    <thead>
                      <tr className="bg-slate-50">
                        {selected.columns.map((column) => (
                          <th key={column} className="border-b border-slate-200 px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-500">
                            {CHECK_FIELDS[column]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.rows.map((row) => (
                        <tr key={row.activityId} className="border-t border-slate-100" data-scheduling-check-row={row.activityId}>
                          {selected.columns.map((column) => (
                            <td key={column} className="px-3 py-2 font-medium">{String(row[column])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
