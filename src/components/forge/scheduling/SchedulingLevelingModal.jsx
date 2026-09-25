"use client";
import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

// Read-only preview + an explicit apply action, owner-only (see SchedulingBoard.jsx -- gated the
// same way Costs/EVM & DCMA are, matching the SCHED-05 migration's decision that resource/cost
// data has no public-select policy).
// The panel content, shared by the legacy centered modal below and the docked
// inspector rail. In the rail, onClose collapses the rail.
export function SchedulingLevelingPanel({ projectId, blocks, onClose }) {
  const [allowExtension, setAllowExtension] = useState(false);
  const previewKey = projectId ? `scheduling:leveling:${projectId}:${allowExtension}` : null;
  // The leveling preview: stale-while-revalidate keyed by project + the
  // allow-extension toggle. The previous preview stays on screen while the
  // toggle refetches instead of blanking to "Computing…".
  const {
    data: preview,
    error: previewError,
    isLoading,
    isRefreshing,
    refresh,
  } = useStaleWhileRevalidate(
    previewKey,
    async () => {
      const response = await fetch(`/api/forge/scheduling/${projectId}/level-resources?allowExtension=${allowExtension}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The leveling preview could not be computed.");
      return result;
    },
    { ttlMs: 60_000 },
  );
  // shownPreview lags the SWR key so toggling "allow extension" keeps the
  // previous preview visible until the new one arrives. Adopted during render
  // (adjust-state-during-render) -- no syncing effect.
  const [shownPreview, setShownPreview] = useState(null);
  if (preview && preview !== shownPreview) {
    setShownPreview(preview);
  }
  const loading = !shownPreview && isLoading;
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");

  const labelByTaskCode = new Map(blocks.map((block) => [block.taskCode, block.label]));

  async function handleApply() {
    setApplying(true);
    const response = await fetch(`/api/forge/scheduling/${projectId}/level-resources/apply`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowExtension }),
    });
    const result = await response.json().catch(() => ({}));
    setApplying(false);
    if (!response.ok) { setMessage(result.error || "Unable to apply the leveled schedule."); return; }
    setMessage(`Applied -- ${result.appliedCount} ${result.appliedCount === 1 ? "activity" : "activities"} pinned to its leveled start date. Reloading the board…`);
    // Applying writes start_on constraints directly onto schedule_blocks -- the board's own CPM run
    // on next load reflects them automatically. A full reload is the simplest way to show that,
    // matching how this modal (and the board generally) has no existing "refetch in place" path.
    setTimeout(() => window.location.reload(), 1200);
  }

  return (
    <div className="p-6 text-slate-950" data-scheduling-leveling>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">Level resources</h2>
            <p className="mt-1 text-sm text-slate-500">Delays non-critical activities within their float to resolve resource over-allocation, least-float activities first.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={allowExtension} onChange={(e) => { setAllowExtension(e.target.checked); setMessage(""); }} />
          Allow extending the project finish date if float alone can&apos;t resolve every conflict
        </label>

        {loading && <div className="mt-4"><ForgeLoadingState label="Computing leveling preview…" /></div>}
        {!loading && !shownPreview && (
          <div className="mt-4">
            <ForgeErrorState title="Unable to load a leveling preview for this project" detail={previewError} onRetry={refresh} />
          </div>
        )}

        {shownPreview && (isLoading || isRefreshing) && (
          <p role="status" className="mt-4 text-xs font-bold text-slate-400">Updating…</p>
        )}
        {shownPreview && previewError && (
          <p role="status" className="mt-2 text-xs font-bold text-slate-400">Could not refresh — showing the last saved leveling preview.</p>
        )}

        {!loading && shownPreview && (
          <>
            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-bold">
                Project finish extension: <span className={shownPreview.projectFinishExtensionDays > 0 ? "text-red-600" : "text-emerald-600"}>{shownPreview.projectFinishExtensionDays} day(s)</span>
              </p>
            </div>

            {shownPreview.unresolvedConflicts.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3" data-scheduling-leveling-unresolved>
                <p className="text-xs font-black uppercase tracking-wide text-amber-800">Unresolved conflicts</p>
                <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
                  {shownPreview.unresolvedConflicts.map((conflict) => (
                    <li key={conflict.task_code}>
                      {conflict.task_code} ({labelByTaskCode.get(conflict.task_code) || ""}) still over capacity on {conflict.conflicts.map((c) => c.date).join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Activities that would move</h3>
              {shownPreview.leveledBlocks.length === 0 && <p className="mt-2 text-xs text-slate-400">No resource conflicts to resolve -- nothing would move.</p>}
              {shownPreview.leveledBlocks.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="pr-2 font-bold">Task</th>
                        <th className="pr-2 font-bold">Original start</th>
                        <th className="pr-2 font-bold">Leveled start</th>
                        <th className="pr-2 font-bold">Delay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownPreview.leveledBlocks.map((block) => (
                        <tr key={block.task_code} className="border-t border-slate-100">
                          <td className="py-1 pr-2 font-bold">{block.task_code} {labelByTaskCode.get(block.task_code) || ""}</td>
                          <td className="py-1 pr-2">{block.original_start}</td>
                          <td className="py-1 pr-2">{block.leveled_start}</td>
                          <td className="py-1 pr-2">{block.delay_days}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={handleApply} disabled={applying || shownPreview.leveledBlocks.length === 0}
                className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" data-scheduling-leveling-apply>
                {applying ? "Applying…" : "Apply this leveling"}
              </button>
              {message && <p role="status" className="text-xs font-bold text-slate-600">{message}</p>}
            </div>
          </>
        )}
    </div>
  );
}

export default function SchedulingLevelingModal(props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <SchedulingLevelingPanel {...props} />
      </div>
    </div>
  );
}
