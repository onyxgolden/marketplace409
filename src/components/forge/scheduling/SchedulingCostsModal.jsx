"use client";
import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

function formatCurrency(amount) {
  return `$${Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Read-only, owner-only view over GET .../cost-rollup -- a non-owner viewing the shared example
// project never sees this menu item at all (see SchedulingBoard.jsx, gated the same way Baselines
// capture is), matching the SCHED-05 migration's decision that cost/rate data stays private.
//
// SCHED-19: selecting a code in "Cost by code" refetches this same route with ?costAccountId=,
// which narrows the top totals and "Cost by activity" down to just that PO#/WO#'s spend -- the
// route does the filtering server-side (a pre-filter feeding the same rollup function), so this
// component only tracks which code (if any) is selected and re-requests.
// The panel content, shared by the legacy centered modal below and the docked
// inspector rail. In the rail, onClose collapses the rail.
export function SchedulingCostsPanel({ projectId, blocks, onClose }) {
  const [costAccountFilter, setCostAccountFilter] = useState(null); // { id, code } | null
  const rollupKey = projectId
    ? `scheduling:cost-rollup:${projectId}:${costAccountFilter ? costAccountFilter.id : "all"}`
    : null;
  // The cost rollup: stale-while-revalidate keyed by project + selected cost
  // code. The previous totals stay on screen while a refetch (or a filter
  // change) is in flight instead of blanking to "Loading…".
  const {
    data: rollup,
    error: rollupError,
    isLoading,
    isRefreshing,
    refresh,
  } = useStaleWhileRevalidate(
    rollupKey,
    async () => {
      const url = `/api/forge/scheduling/${projectId}/cost-rollup${costAccountFilter ? `?costAccountId=${encodeURIComponent(costAccountFilter.id)}` : ""}`;
      const response = await fetch(url);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The cost rollup could not be computed.");
      return result;
    },
    { ttlMs: 60_000 },
  );
  // shownRollup keeps the previous totals on screen while a refetch (or a
  // filter change swapping the SWR key) is in flight; shownByCostAccount keeps
  // the "Cost by code" table (which only comes back on unfiltered requests)
  // across filter selections. Adopted during render via the
  // adjust-state-during-render pattern -- no syncing effect needed.
  const [shown, setShown] = useState({ key: rollupKey, rollup: null, byCostAccount: null });
  if (shown.key !== rollupKey || (rollup && rollup !== shown.rollup)) {
    setShown({
      key: rollupKey,
      rollup: rollup ?? shown.rollup,
      byCostAccount:
        !costAccountFilter && rollup?.byCostAccount ? rollup.byCostAccount : shown.byCostAccount,
    });
  }
  const shownRollup = shown.rollup;
  const byCostAccount = shown.byCostAccount;

  const labelByTaskCode = new Map(blocks.map((block) => [block.taskCode, block.label]));

  const loading = !shownRollup && isLoading;

  return (
    <div className="p-6 text-slate-950" data-scheduling-costs>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">Costs &amp; resource loading</h2>
            <p className="mt-1 text-sm text-slate-500">Budgeted/actual cost from resource assignments and expenses, plus any day a resource is booked over its daily capacity.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        {costAccountFilter && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2" data-scheduling-cost-account-filter>
            <span className="text-xs font-bold text-amber-800">Filtered to cost code {costAccountFilter.code}</span>
            <button type="button" onClick={() => setCostAccountFilter(null)} className="text-xs font-bold text-amber-700 underline hover:text-amber-900">Clear filter</button>
          </div>
        )}

        {loading && <div className="mt-4"><ForgeLoadingState label="Loading cost data…" /></div>}
        {!loading && !shownRollup && (
          <div className="mt-4">
            <ForgeErrorState title="Unable to load cost data for this project" detail={rollupError} onRetry={refresh} />
          </div>
        )}

        {shownRollup && (isLoading || isRefreshing) && (
          <p role="status" className="mt-4 text-xs font-bold text-slate-400">Updating…</p>
        )}
        {shownRollup && rollupError && (
          <p role="status" className="mt-2 text-xs font-bold text-slate-400">Could not refresh — showing the last saved cost rollup.</p>
        )}

        {!loading && shownRollup && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Budgeted</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(shownRollup.project.budgeted_cost)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Actual</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(shownRollup.project.actual_cost)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Remaining</p>
                <p className={`mt-1 text-lg font-black ${shownRollup.project.remaining_cost < 0 ? "text-red-600" : ""}`}>{formatCurrency(shownRollup.project.remaining_cost)}</p>
              </div>
            </div>

            {shownRollup.overallocations.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3" data-scheduling-overallocations>
                <p className="text-xs font-black uppercase tracking-wide text-amber-800">Over-allocated resources</p>
                <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
                  {shownRollup.overallocations.map((conflict) => (
                    <li key={`${conflict.resource_id}-${conflict.date}`}>
                      {conflict.resource_id} on {conflict.date}: {conflict.allocated_units} / {conflict.max_units_per_day} per day (over by {conflict.over_by})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {byCostAccount && byCostAccount.length > 0 && (
              <div className="mt-5">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Cost by code</h3>
                <p className="mt-1 text-xs text-slate-400">Click a code to filter the totals above and the activity table below down to just that PO#/WO#.</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="pr-2 font-bold">Code</th>
                        <th className="pr-2 font-bold">Budgeted</th>
                        <th className="pr-2 font-bold">Actual</th>
                        <th className="pr-2 font-bold">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCostAccount.map((row) => (
                        <tr key={row.cost_account_id ?? "uncoded"} className="border-t border-slate-100">
                          <td className="py-1 pr-2">
                            {row.cost_account_id ? (
                              <button type="button" onClick={() => setCostAccountFilter({ id: row.cost_account_id, code: row.code })}
                                className="font-bold text-sky-700 underline hover:text-sky-900">
                                {row.code} — {row.name}
                              </button>
                            ) : (
                              <span className="font-bold text-slate-500">{row.name}</span>
                            )}
                          </td>
                          <td className="py-1 pr-2">{formatCurrency(row.budgeted_cost)}</td>
                          <td className="py-1 pr-2">{formatCurrency(row.actual_cost)}</td>
                          <td className={`py-1 pr-2 ${row.remaining_cost < 0 ? "text-red-600" : ""}`}>{formatCurrency(row.remaining_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-5">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Cost by activity</h3>
              {shownRollup.byBlock.length === 0 && <p className="mt-2 text-xs text-slate-400">No resource assignments or expenses recorded yet.</p>}
              {shownRollup.byBlock.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="pr-2 font-bold">Task</th>
                        <th className="pr-2 font-bold">Budgeted</th>
                        <th className="pr-2 font-bold">Actual</th>
                        <th className="pr-2 font-bold">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownRollup.byBlock.map((row) => (
                        <tr key={row.block_id} className="border-t border-slate-100">
                          <td className="py-1 pr-2 font-bold">{row.task_code} {labelByTaskCode.get(row.task_code) || ""}</td>
                          <td className="py-1 pr-2">{formatCurrency(row.budgeted_cost)}</td>
                          <td className="py-1 pr-2">{formatCurrency(row.actual_cost)}</td>
                          <td className={`py-1 pr-2 ${row.remaining_cost < 0 ? "text-red-600" : ""}`}>{formatCurrency(row.remaining_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
    </div>
  );
}

export default function SchedulingCostsModal(props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <SchedulingCostsPanel {...props} />
      </div>
    </div>
  );
}
