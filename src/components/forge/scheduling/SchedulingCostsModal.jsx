"use client";
import { useEffect, useState } from "react";

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
export default function SchedulingCostsModal({ projectId, blocks, onClose }) {
  const [rollup, setRollup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [costAccountFilter, setCostAccountFilter] = useState(null); // { id, code } | null
  // byCostAccount only comes back on an unfiltered request -- kept separately so the "Cost by
  // code" table itself doesn't disappear once a code is selected and rollup.byCostAccount is gone.
  const [byCostAccount, setByCostAccount] = useState(null);

  const labelByTaskCode = new Map(blocks.map((block) => [block.taskCode, block.label]));

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    (async () => {
      const url = `/api/forge/scheduling/${projectId}/cost-rollup${costAccountFilter ? `?costAccountId=${encodeURIComponent(costAccountFilter.id)}` : ""}`;
      const response = await fetch(url);
      const result = await response.json().catch(() => ({}));
      if (cancelled) return;
      setRollup(response.ok ? result : null);
      if (response.ok && result.byCostAccount) setByCostAccount(result.byCostAccount);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, costAccountFilter]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-costs>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
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

        {loading && <p className="mt-4 text-xs text-slate-400">Loading…</p>}
        {!loading && !rollup && <p className="mt-4 text-xs text-slate-400">Unable to load cost data for this project.</p>}

        {!loading && rollup && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Budgeted</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(rollup.project.budgeted_cost)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Actual</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(rollup.project.actual_cost)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Remaining</p>
                <p className={`mt-1 text-lg font-black ${rollup.project.remaining_cost < 0 ? "text-red-600" : ""}`}>{formatCurrency(rollup.project.remaining_cost)}</p>
              </div>
            </div>

            {rollup.overallocations.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3" data-scheduling-overallocations>
                <p className="text-xs font-black uppercase tracking-wide text-amber-800">Over-allocated resources</p>
                <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
                  {rollup.overallocations.map((conflict) => (
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
              {rollup.byBlock.length === 0 && <p className="mt-2 text-xs text-slate-400">No resource assignments or expenses recorded yet.</p>}
              {rollup.byBlock.length > 0 && (
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
                      {rollup.byBlock.map((row) => (
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
    </div>
  );
}
