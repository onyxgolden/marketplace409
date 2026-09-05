"use client";
import { useEffect, useState } from "react";

// Read-only preview + an explicit apply action, owner-only (see SchedulingBoard.jsx -- gated the
// same way Costs/EVM & DCMA are, matching the SCHED-05 migration's decision that resource/cost
// data has no public-select policy).
export default function SchedulingLevelingModal({ projectId, blocks, onClose }) {
  const [allowExtension, setAllowExtension] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");

  const labelByTaskCode = new Map(blocks.map((block) => [block.taskCode, block.label]));

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setMessage("");
    (async () => {
      const response = await fetch(`/api/forge/scheduling/${projectId}/level-resources?allowExtension=${allowExtension}`);
      const result = await response.json().catch(() => ({}));
      if (!cancelled) { setPreview(response.ok ? result : null); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [projectId, allowExtension]);

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-leveling>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">Level resources</h2>
            <p className="mt-1 text-sm text-slate-500">Delays non-critical activities within their float to resolve resource over-allocation, least-float activities first.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={allowExtension} onChange={(e) => setAllowExtension(e.target.checked)} />
          Allow extending the project finish date if float alone can&apos;t resolve every conflict
        </label>

        {loading && <p className="mt-4 text-xs text-slate-400">Computing…</p>}
        {!loading && !preview && <p className="mt-4 text-xs text-slate-400">Unable to load a leveling preview for this project.</p>}

        {!loading && preview && (
          <>
            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-bold">
                Project finish extension: <span className={preview.projectFinishExtensionDays > 0 ? "text-red-600" : "text-emerald-600"}>{preview.projectFinishExtensionDays} day(s)</span>
              </p>
            </div>

            {preview.unresolvedConflicts.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3" data-scheduling-leveling-unresolved>
                <p className="text-xs font-black uppercase tracking-wide text-amber-800">Unresolved conflicts</p>
                <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
                  {preview.unresolvedConflicts.map((conflict) => (
                    <li key={conflict.task_code}>
                      {conflict.task_code} ({labelByTaskCode.get(conflict.task_code) || ""}) still over capacity on {conflict.conflicts.map((c) => c.date).join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Activities that would move</h3>
              {preview.leveledBlocks.length === 0 && <p className="mt-2 text-xs text-slate-400">No resource conflicts to resolve -- nothing would move.</p>}
              {preview.leveledBlocks.length > 0 && (
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
                      {preview.leveledBlocks.map((block) => (
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
              <button type="button" onClick={handleApply} disabled={applying || preview.leveledBlocks.length === 0}
                className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" data-scheduling-leveling-apply>
                {applying ? "Applying…" : "Apply this leveling"}
              </button>
              {message && <p role="status" className="text-xs font-bold text-slate-600">{message}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
