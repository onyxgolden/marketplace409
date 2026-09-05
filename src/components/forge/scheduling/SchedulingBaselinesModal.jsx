"use client";
import { useEffect, useState } from "react";

// Positive variance = later/longer than baseline (a slip); negative = earlier/shorter (ahead).
// Matches schedulingBaselines.js's sign convention exactly -- see computeBlockVariance.
function formatDateVarianceDays(days) {
  if (days == null) return "—";
  if (days === 0) return "On schedule";
  return days > 0 ? `${days}d late` : `${Math.abs(days)}d early`;
}
function formatDurationVarianceDays(days) {
  if (days == null) return "—";
  if (days === 0) return "Same duration";
  return days > 0 ? `${days}d longer` : `${Math.abs(days)}d shorter`;
}
function varianceToneClass(days) {
  if (days == null || days === 0) return "text-slate-500";
  return days > 0 ? "text-red-600" : "text-emerald-600";
}

// blocks (the board's current in-memory Gantt blocks) supplies a human label per taskCode --
// computeScheduleVariance's compared rows only carry taskCode, since that's the one durable
// identifier a baseline snapshot and the live board are guaranteed to share.
export default function SchedulingBaselinesModal({ projectId, isOwner, blocks, onClose }) {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [captureName, setCaptureName] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedBaselineId, setSelectedBaselineId] = useState(null);
  const [variance, setVariance] = useState(null);
  const [varianceLoading, setVarianceLoading] = useState(false);

  const labelByTaskCode = new Map(blocks.map((block) => [block.taskCode, block.label]));

  async function loadBaselines() {
    setLoading(true);
    const response = await fetch(`/api/forge/scheduling/${projectId}/baselines`);
    const result = await response.json().catch(() => ({}));
    setBaselines(result.baselines || []);
    setLoading(false);
  }

  // One-time fetch on mount / when the modal is reopened for a different project; loadBaselines is
  // omitted from deps deliberately -- it's redefined every render, so including it would refire
  // this on every render instead of only when projectId actually changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { loadBaselines(); }, [projectId]);

  async function handleCapture() {
    const name = captureName.trim();
    if (!name) return;
    setCapturing(true); setMessage("");
    const response = await fetch(`/api/forge/scheduling/${projectId}/baselines`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
    });
    const result = await response.json().catch(() => ({}));
    setCapturing(false);
    if (!response.ok) { setMessage(result.error || "Unable to capture a baseline."); return; }
    setCaptureName("");
    setMessage("Baseline captured.");
    await loadBaselines();
  }

  async function selectBaseline(baselineId) {
    setSelectedBaselineId(baselineId);
    setVariance(null);
    setVarianceLoading(true);
    const response = await fetch(`/api/forge/scheduling/${projectId}/baselines/${baselineId}/variance`);
    const result = await response.json().catch(() => ({}));
    setVarianceLoading(false);
    if (response.ok) setVariance(result);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-baselines>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">Baselines &amp; variance</h2>
            <p className="mt-1 text-sm text-slate-500">Snapshot the current CPM-computed schedule, then compare it against real progress later.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        {isOwner && (
          <div className="mt-5 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-600">Capture a new baseline</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={captureName} onChange={(e) => setCaptureName(e.target.value)} placeholder="e.g. Approved baseline"
                className="rounded border border-slate-300 px-2 py-1 text-sm" />
              <button type="button" onClick={handleCapture} disabled={capturing || !captureName.trim()}
                className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{capturing ? "Capturing…" : "Capture baseline"}</button>
            </div>
            {message && <p role="status" className="mt-2 text-xs font-bold text-slate-600">{message}</p>}
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Captured baselines</h3>
          {loading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
          {!loading && baselines.length === 0 && <p className="mt-2 text-xs text-slate-400">No baselines captured yet.</p>}
          <ul className="mt-2 space-y-1.5">
            {baselines.map((baseline) => (
              <li key={baseline.id}>
                <button type="button" onClick={() => selectBaseline(baseline.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-bold ${selectedBaselineId === baseline.id ? "border-amber-500 bg-amber-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  {baseline.name} <span className="font-normal text-slate-400">— {new Date(baseline.createdAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selectedBaselineId && (
          <div className="mt-6" data-scheduling-baseline-variance>
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Variance</h3>
            {varianceLoading && <p className="mt-2 text-xs text-slate-400">Computing…</p>}
            {!varianceLoading && variance && (
              <>
                <div className="mt-2 rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-bold">
                    Project finish: {variance.rollup.baselineProjectFinish || "—"} &rarr; {variance.rollup.currentProjectFinish || "—"}{" "}
                    <span className={varianceToneClass(variance.rollup.projectFinishVarianceDays)}>({formatDateVarianceDays(variance.rollup.projectFinishVarianceDays)})</span>
                  </p>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="pr-2 font-bold">Task</th>
                        <th className="pr-2 font-bold">Start variance</th>
                        <th className="pr-2 font-bold">Finish variance</th>
                        <th className="pr-2 font-bold">Duration variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variance.compared.map((row) => (
                        <tr key={row.taskCode} className="border-t border-slate-100">
                          <td className="py-1 pr-2 font-bold">{row.taskCode} {labelByTaskCode.get(row.taskCode) || ""}</td>
                          <td className={`py-1 pr-2 ${varianceToneClass(row.startVarianceDays)}`}>{formatDateVarianceDays(row.startVarianceDays)}{row.usedActualStart && " (actual)"}</td>
                          <td className={`py-1 pr-2 ${varianceToneClass(row.finishVarianceDays)}`}>{formatDateVarianceDays(row.finishVarianceDays)}{row.usedActualFinish && " (actual)"}</td>
                          <td className={`py-1 pr-2 ${varianceToneClass(row.durationVarianceDays)}`}>{formatDurationVarianceDays(row.durationVarianceDays)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {variance.addedSinceBaseline.length > 0 && <p className="mt-3 text-xs text-slate-500">Added since baseline: {variance.addedSinceBaseline.map((b) => b.label).join(", ")}</p>}
                {variance.removedSinceBaseline.length > 0 && <p className="mt-1 text-xs text-slate-500">Removed since baseline: {variance.removedSinceBaseline.map((b) => b.label).join(", ")}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
