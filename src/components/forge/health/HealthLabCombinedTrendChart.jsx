"use client";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 240;
const PADDING = { top: 16, right: 16, bottom: 28, left: 44 };

// Fixed, entity-keyed slot order from the validated categorical palette (dataviz skill,
// references/palette.md) -- adjacent-pairlist ("lines" context): worst adjacent CVD Delta E 9.1
// light / 8.4 dark, clears the >=8 target. Keyed by marker name, not by position, so a marker's
// color never shifts when the set of markers on screen changes (recolor-on-filter is a documented
// anti-pattern this avoids).
const SERIES_SLOTS = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];
const MARKER_SLOT = {
  "Hemoglobin A1c": 0, "Glucose": 1, "Total cholesterol": 2, "LDL cholesterol": 3,
  "HDL cholesterol": 4, "Triglycerides": 5, "Creatinine": 6, "Non-HDL cholesterol": 7,
};
function slotFor(markerName, fallbackIndex) {
  return SERIES_SLOTS[MARKER_SLOT[markerName] ?? (fallbackIndex % SERIES_SLOTS.length)];
}

// timeZone: "UTC" is required -- collected_on is a plain date (no time component), and formatting
// it in the viewer's local timezone can roll it back a day for anyone west of UTC.
const DATE_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function dateLabel(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return DATE_LABEL.format(new Date(Date.UTC(year, month - 1, day)));
}

// Rounds a span into a "nice" step (1/2/5 x 10^n) so axis ticks land on clean numbers instead of
// whatever the data's min/max happen to be.
function niceStep(roughStep) {
  if (roughStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
function formatTick(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 1 : 0);
}

// Several markers plotted together on one *real-unit* axis -- never indexed, never dual-axis.
// The caller groups markers into tiers with genuinely comparable magnitudes (e.g. "under 15" vs
// "50 and up") before handing them here; mixing scales that differ by 10x+ on one axis flattens
// the smaller series into a straight line, which is the same "invented correlation" problem a
// dual-axis chart has, just inside a single axis instead of two -- see the dataviz skill's
// anti-patterns reference. A marker with only one draw on file has no trend to plot and is
// reported back via onSkipped rather than silently dropped.
export default function HealthLabCombinedTrendChart({ title, groupedLabs }) {
  const seriesList = Object.entries(groupedLabs)
    .map(([markerName, points], index) => ({ markerName, index, points: [...points].sort((a, b) => a.collected_on.localeCompare(b.collected_on)) }))
    .filter((series) => series.points.length >= 2);
  const skipped = Object.entries(groupedLabs).filter(([, points]) => points.length < 2).map(([markerName]) => markerName);
  if (seriesList.length === 0) return null;

  const allDates = [...new Set(seriesList.flatMap((series) => series.points.map((point) => point.collected_on)))].sort();
  const dateIndex = Object.fromEntries(allDates.map((date, index) => [date, index]));
  const unit = seriesList[0].points.at(-1).unit || "";

  const allValues = seriesList.flatMap((series) => series.points.map((point) => Number(point.value_numeric)));
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  const step = niceStep((dataMax - dataMin || dataMax || 1) / 4);
  const min = Math.floor(dataMin / step) * step;
  const max = Math.ceil(dataMax / step) * step === min ? min + step : Math.ceil(dataMax / step) * step;
  const ticks = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Math.round(tick * 1000) / 1000);

  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (date) => PADDING.left + (allDates.length > 1 ? (dateIndex[date] / (allDates.length - 1)) * innerWidth : innerWidth / 2);
  const yFor = (value) => PADDING.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight;

  const varStyle = Object.fromEntries(seriesList.map((series, index) => {
    const slot = slotFor(series.markerName, series.index);
    return [`--series-${index}`, slot.light];
  }));
  const darkVarStyle = seriesList.map((series, index) => `--series-${index}:${slotFor(series.markerName, series.index).dark}`).join(";");

  return (
    <div className="health-combined-chart rounded-xl bg-slate-100 p-4 dark:bg-slate-800" style={varStyle}>
      <style>{`
        @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .health-combined-chart { ${darkVarStyle} } }
        :root[data-theme="dark"] .health-combined-chart { ${darkVarStyle} }
      `}</style>
      <p className="font-black">{title}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{unit ? `Shared axis, ${unit}` : "Shared axis"}</p>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="mt-2 w-full" role="img" aria-label={`${title}: ${seriesList.map((series) => `${series.markerName} ${series.points.map((point) => `${dateLabel(point.collected_on)} ${point.value_numeric}`).join(", ")}`).join("; ")}`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={yFor(tick)} y2={yFor(tick)} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1"/>
            <text x={PADDING.left - 6} y={yFor(tick)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 dark:fill-slate-400" fontSize="9">{formatTick(tick)}</text>
          </g>
        ))}
        {seriesList.map((series, index) => {
          const color = `var(--series-${index})`;
          const linePoints = series.points.map((point) => `${xFor(point.collected_on)},${yFor(Number(point.value_numeric))}`).join(" ");
          return (
            <g key={series.markerName}>
              <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              {series.points.map((point, pointIndex) => (
                <circle key={pointIndex} cx={xFor(point.collected_on)} cy={yFor(Number(point.value_numeric))} r="4" fill={color} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="2">
                  <title>{`${series.markerName}: ${dateLabel(point.collected_on)} — ${point.value_numeric} ${point.unit || ""}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between px-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
        <span>{dateLabel(allDates[0])}</span>
        <span>{dateLabel(allDates.at(-1))}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {seriesList.map((series, index) => {
          const latest = series.points.at(-1);
          const first = series.points[0];
          const delta = Number(latest.value_numeric) - Number(first.value_numeric);
          return (
            <div key={series.markerName} className="flex items-center gap-1.5 text-xs">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(--series-${index})` }}/>
              <span className="font-bold text-slate-700 dark:text-slate-300">{series.markerName}</span>
              <span className="text-slate-500 dark:text-slate-400">{latest.value_numeric} {latest.unit} ({delta > 0 ? "+" : ""}{Math.round(delta * 100) / 100})</span>
            </div>
          );
        })}
      </div>
      {skipped.length > 0 && <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Not enough history yet for a trend: {skipped.join(", ")}.</p>}
    </div>
  );
}
