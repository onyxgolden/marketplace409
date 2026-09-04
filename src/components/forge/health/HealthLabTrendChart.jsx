"use client";

const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;
const PADDING = { top: 12, right: 12, bottom: 8, left: 12 };

const FLAG_DOT_CLASS = {
  critical: "fill-red-600",
  high: "fill-red-600",
  low: "fill-blue-600",
  normal: "fill-emerald-600",
  unknown: "fill-slate-500",
};
function valueToneClass(flag) {
  return flag === "high" || flag === "critical" ? "text-red-600" : flag === "low" ? "text-blue-600" : "font-black";
}

// timeZone: "UTC" is required -- collected_on is a plain date (no time component), and formatting
// it in the viewer's local timezone can roll it back a day for anyone west of UTC.
const DATE_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function dateLabel(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return DATE_LABEL.format(new Date(Date.UTC(year, month - 1, day)));
}

// One marker's real recorded values over time, oldest to newest, with a shaded band for the
// reference range when one was captured at review time -- never fabricates a trend line for a
// marker with only one draw on file, and never fabricates a target band when no reference range
// was entered (labs vary their own reference ranges, so this is deliberately never guessed by
// the OCR parser -- only what a person typed in during document review ever appears here).
export default function HealthLabTrendChart({ markerName, points }) {
  const sorted = [...points].sort((a, b) => a.collected_on.localeCompare(b.collected_on));
  const latest = sorted.at(-1);
  const unit = latest.unit || "";

  if (sorted.length < 2) {
    return (
      <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-black">{markerName}</p>
          <span className={`font-black tabular-nums ${valueToneClass(latest.flag)}`}>{latest.value_numeric ?? latest.value_text} {unit}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{dateLabel(latest.collected_on)} · one result on file</p>
      </div>
    );
  }

  const referenceLow = sorted.map((point) => point.reference_low).filter((value) => value != null).at(-1) ?? null;
  const referenceHigh = sorted.map((point) => point.reference_high).filter((value) => value != null).at(-1) ?? null;
  const values = sorted.map((point) => Number(point.value_numeric));
  const rangeValues = [...values, ...(referenceLow != null ? [referenceLow] : []), ...(referenceHigh != null ? [referenceHigh] : [])];
  const min = Math.min(...rangeValues);
  const max = Math.max(...rangeValues);
  const span = max - min || 1;
  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const xFor = (index) => PADDING.left + (index / (sorted.length - 1)) * innerWidth;
  const yFor = (value) => PADDING.top + innerHeight - ((value - min) / span) * innerHeight;
  const linePoints = sorted.map((point, index) => `${xFor(index)},${yFor(Number(point.value_numeric))}`).join(" ");
  const chartLabel = `${markerName} over time: ${sorted.map((point) => `${dateLabel(point.collected_on)} ${point.value_numeric} ${unit}`).join(", ")}`;

  return (
    <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-black">{markerName}</p>
        <span className={`font-black tabular-nums ${valueToneClass(latest.flag)}`}>{latest.value_numeric ?? latest.value_text} {unit}</span>
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="mt-2 w-full" role="img" aria-label={chartLabel}>
        {referenceLow != null && referenceHigh != null && (
          <rect x={PADDING.left} y={yFor(referenceHigh)} width={innerWidth} height={Math.max(0, yFor(referenceLow) - yFor(referenceHigh))} className="fill-emerald-500/10" />
        )}
        <polyline points={linePoints} fill="none" strokeWidth="2" className="stroke-amber-500" />
        {sorted.map((point, index) => (
          <circle key={point.id ?? index} cx={xFor(index)} cy={yFor(Number(point.value_numeric))} r="3.5" className={FLAG_DOT_CLASS[point.flag] || FLAG_DOT_CLASS.unknown} />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
        <span>{dateLabel(sorted[0].collected_on)}</span>
        <span>{dateLabel(sorted.at(-1).collected_on)}</span>
      </div>
      {(referenceLow != null || referenceHigh != null) && (
        <p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">Target: {referenceLow != null && referenceHigh != null ? `${referenceLow}–${referenceHigh}` : referenceLow != null ? `≥${referenceLow}` : `≤${referenceHigh}`} {unit}</p>
      )}
    </div>
  );
}
