"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD_OPTIONS = [1, 2, 3, 5, 7];

const SEVERITY_STYLES = {
  major: "border-red-200 bg-red-50 text-red-800",
  minor: "border-slate-200 bg-slate-50 text-slate-700",
};

const DIRECTION_STYLES = {
  late: "border-red-200 bg-red-50 text-red-700",
  early: "border-sky-200 bg-sky-50 text-sky-700",
  mixed: "border-amber-200 bg-amber-50 text-amber-800",
};

function formatDateRange(item) {
  const baseline = `${item.baselineStart ?? "?"} → ${item.baselineFinish ?? "?"}`;
  const current = `${item.currentStart ?? "?"} → ${item.currentFinish ?? "?"}`;
  return { baseline, current };
}

// Read-only "Baseline Drift" panel for the docked inspector rail. Fetches the
// deterministic drift report from GET /api/forge/scheduling/[projectId]/drift
// and lists drifted activities with baseline vs current dates and severity.
// Nothing here changes the schedule -- the threshold only re-queries the report.
export function DriftAlertsPanel({ projectId, onClose }) {
  const [thresholdDays, setThresholdDays] = useState(2);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Monotonic request id: only the latest request for the current
  // {projectId, threshold} may update state, so a slow earlier response can
  // never overwrite a newer report (e.g. user switches 2d -> 5d and the 2d
  // response arrives last).
  const requestSeq = useRef(0);

  const load = useCallback(async (threshold) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/forge/scheduling/${projectId}/drift?thresholdDays=${threshold}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Drift could not be computed right now.");
      if (requestSeq.current === seq) setReport(body);
    } catch (err) {
      if (requestSeq.current === seq) {
        setError(err.message);
        setReport(null);
      }
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Fetch-in-effect is intentional here (matches the SchedulingBoard
    // loadResources/loadCostAccounts pattern).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (projectId) load(thresholdDays);
    // Intentional: re-fetch only on project/threshold change, not on `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, thresholdDays]);

  const summary = report?.summary;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">Baseline Drift</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Activities that moved since the latest baseline. Read-only — nothing here changes the schedule.
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close panel"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-lg font-black text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            &times;
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="drift-threshold" className="text-xs font-bold text-slate-600">Flag moves over</label>
        <select id="drift-threshold" value={thresholdDays}
          onChange={(event) => setThresholdDays(Number(event.target.value))}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50">
          {THRESHOLD_OPTIONS.map((days) => (
            <option key={days} value={days}>{days} {days === 1 ? "day" : "days"}</option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {loading && !report && (
        <p className="text-xs italic text-slate-500">Computing drift…</p>
      )}

      {report && !report.hasBaseline && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
          No baseline has been captured for this project yet. Capture one in the{" "}
          <span className="font-bold">Baselines</span> tab and drift alerts will appear here.
        </p>
      )}

      {report?.hasBaseline && summary && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="text-sm font-semibold text-slate-900">
            {summary.driftedCount === 0
              ? `No drift beyond ${report.thresholdDays}d vs "${report.baselineName}".`
              : `${summary.driftedCount} drifted (${summary.majorCount} major) vs "${report.baselineName}"`}
            <span className="block text-xs font-normal text-slate-500">
              As of {report.asOf}
              {summary.projectFinishVarianceDays != null && summary.projectFinishVarianceDays !== 0
                ? ` · project finish ${summary.projectFinishVarianceDays > 0 ? "+" : ""}${summary.projectFinishVarianceDays}d`
                : ""}
              {summary.completedExcludedCount > 0 ? ` · ${summary.completedExcludedCount} completed excluded` : ""}
            </span>
          </p>
          {report.drifted.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {report.drifted.map((item) => {
                const { baseline, current } = formatDateRange(item);
                return (
                  <li key={item.taskCode}
                    className={`rounded-lg border px-2.5 py-1.5 ${SEVERITY_STYLES[item.severity]}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-bold text-slate-900">
                        {item.taskCode}{item.label ? ` — ${item.label}` : ""}
                      </p>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-black uppercase ${SEVERITY_STYLES[item.severity]}`}>
                        {item.severity}
                      </span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-black uppercase ${DIRECTION_STYLES[item.direction]}`}>
                        {item.direction}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Baseline <span className="font-semibold">{baseline}</span>
                      <br />
                      Current <span className="font-semibold">{current}</span>
                      <span className="text-slate-500"> · {item.detail}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs italic text-slate-500">Everything is within the threshold.</p>
          )}
        </div>
      )}
    </div>
  );
}
