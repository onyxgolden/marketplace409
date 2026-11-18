import { getMarkerPresentation } from "@/domains/health/healthLabPresentation";

// Shared compact row value/status/bar view for the Overview latest list and
// the Labs history rows. Display-only: the status word comes from comparing
// the recorded value to the recorded reference range, never from the stored
// flag and never as "Optimal". One neutral chip style for all three
// statuses -- color never carries the meaning, the words do. No
// green-to-red gradient: the bar is a single muted track with a position
// marker pinned to the edge (with an arrow) for out-of-range values.
export default function HealthLabMarkerDisplay({ point }) {
  const presentation = getMarkerPresentation(point);
  const valueText = point.value_numeric ?? point.value_text;
  const { interval, status, position, flagNote } = presentation;

  const ariaLabel = status && interval
    ? `${point.marker_name}: ${valueText} ${point.unit || ""}, reference range ${interval.low} to ${interval.high} ${point.unit || ""}, ${status}`
    : `${point.marker_name}: ${valueText} ${point.unit || ""}`;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="break-words font-black tabular-nums">{valueText} {point.unit}</span>
        {status && <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-black dark:bg-slate-700">{status}</span>}
      </div>
      {interval && status ? (
        <div className="mt-1.5" role="img" aria-label={ariaLabel}>
          <div className="relative h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700">
            {status === "Within range" ? (
              <span
                aria-hidden="true"
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 dark:border-slate-900 dark:bg-white"
                style={{ left: `${position}%` }}
              />
            ) : (
              <span
                aria-hidden="true"
                className={`absolute top-1/2 -translate-y-1/2 text-sm font-black leading-none text-slate-900 dark:text-white ${status === "Below range" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
              >
                {status === "Below range" ? "◀" : "▶"}
              </span>
            )}
          </div>
          <div className="mt-1 flex justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="break-words">Low {interval.low}</span>
            <span className="break-words">High {interval.high}</span>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Reference range unavailable</p>
      )}
      {flagNote && <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-300">{flagNote}</p>}
    </div>
  );
}
