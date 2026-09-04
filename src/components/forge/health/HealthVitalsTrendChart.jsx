"use client";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 28, left: 44 };

// Fixed two-slot pair from the same validated categorical palette used by the lab combined chart
// (dataviz skill, references/palette.md) -- primary is always slot 0 (blue), secondary always slot
// 1 (orange), regardless of measurement type, so a reader who learns "blue = systolic" once never
// has to relearn it on a different vitals chart.
const PRIMARY_COLOR = { light: "#2a78d6", dark: "#3987e5" };
const SECONDARY_COLOR = { light: "#eb6834", dark: "#d95926" };

// timeZone: "UTC" is required -- measured_at is saved as UTC midnight from a plain date input (see
// the workout date bug this app already hit once), so formatting in the viewer's local timezone
// can roll it back a day for anyone west of UTC.
const DATE_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function dateLabel(measuredAt) {
  return DATE_LABEL.format(new Date(measuredAt));
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

// One vitals measurement type's real recorded values over time. Blood pressure is the only type
// with a secondary series (diastolic alongside systolic) -- both mmHg, so sharing one axis is the
// same real-unit measurement, not the "different scales on one axis" problem the lab combined chart
// avoids by tiering. Every other type (steps, heart rate, SpO2, sleep, weight) is always a single
// series. A type with only one entry on file has no trend to plot -- shown as a value, not a chart.
export default function HealthVitalsTrendChart({ title, unit, points, primaryLabel, secondaryLabel }) {
  const sorted = [...points].sort((a, b) => new Date(a.measured_at) - new Date(b.measured_at));
  const latest = sorted.at(-1);
  const hasSecondary = Boolean(secondaryLabel) && sorted.some((point) => point.secondary_value_numeric != null);

  if (sorted.length < 2) {
    return (
      <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-black">{title}</p>
          <span className="font-black tabular-nums">{latest.value_numeric}{hasSecondary && latest.secondary_value_numeric != null ? `/${latest.secondary_value_numeric}` : ""} {unit}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{dateLabel(latest.measured_at)} · one entry on file</p>
      </div>
    );
  }

  const values = sorted.flatMap((point) => hasSecondary ? [Number(point.value_numeric), Number(point.secondary_value_numeric)] : [Number(point.value_numeric)]);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const step = niceStep((dataMax - dataMin || dataMax || 1) / 4);
  const min = Math.floor(dataMin / step) * step;
  const max = Math.ceil(dataMax / step) * step === min ? min + step : Math.ceil(dataMax / step) * step;
  const ticks = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Math.round(tick * 1000) / 1000);

  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (index) => PADDING.left + (sorted.length > 1 ? (index / (sorted.length - 1)) * innerWidth : innerWidth / 2);
  const yFor = (value) => PADDING.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight;

  const primaryLinePoints = sorted.map((point, index) => `${xFor(index)},${yFor(Number(point.value_numeric))}`).join(" ");
  const secondaryLinePoints = hasSecondary ? sorted.map((point, index) => `${xFor(index)},${yFor(Number(point.secondary_value_numeric))}`).join(" ") : null;

  const chartLabel = `${title} over time: ${sorted.map((point) => `${dateLabel(point.measured_at)} ${point.value_numeric}${hasSecondary ? `/${point.secondary_value_numeric}` : ""} ${unit}`).join(", ")}`;
  const latestPrimary = latest.value_numeric;
  const latestSecondary = latest.secondary_value_numeric;

  return (
    <div className="health-vitals-chart rounded-xl bg-slate-100 p-4 dark:bg-slate-800" style={{ "--vitals-primary": PRIMARY_COLOR.light, "--vitals-secondary": SECONDARY_COLOR.light }}>
      <style>{`
        @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .health-vitals-chart { --vitals-primary: ${PRIMARY_COLOR.dark}; --vitals-secondary: ${SECONDARY_COLOR.dark}; } }
        :root[data-theme="dark"] .health-vitals-chart { --vitals-primary: ${PRIMARY_COLOR.dark}; --vitals-secondary: ${SECONDARY_COLOR.dark}; }
      `}</style>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-black">{title}</p>
        {!hasSecondary && <span className="font-black tabular-nums">{latestPrimary} {unit}</span>}
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="mt-2 w-full" role="img" aria-label={chartLabel}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={yFor(tick)} y2={yFor(tick)} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1" />
            <text x={PADDING.left - 6} y={yFor(tick)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 dark:fill-slate-400" fontSize="9">{formatTick(tick)}</text>
          </g>
        ))}
        <polyline points={primaryLinePoints} fill="none" stroke="var(--vitals-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {sorted.map((point, index) => (
          <circle key={`primary-${point.id ?? index}`} cx={xFor(index)} cy={yFor(Number(point.value_numeric))} r="4" fill="var(--vitals-primary)" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="2">
            <title>{`${primaryLabel || title}: ${dateLabel(point.measured_at)} — ${point.value_numeric} ${unit}`}</title>
          </circle>
        ))}
        {hasSecondary && <polyline points={secondaryLinePoints} fill="none" stroke="var(--vitals-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {hasSecondary && sorted.map((point, index) => point.secondary_value_numeric != null && (
          <circle key={`secondary-${point.id ?? index}`} cx={xFor(index)} cy={yFor(Number(point.secondary_value_numeric))} r="4" fill="var(--vitals-secondary)" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="2">
            <title>{`${secondaryLabel}: ${dateLabel(point.measured_at)} — ${point.secondary_value_numeric} ${unit}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between px-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
        <span>{dateLabel(sorted[0].measured_at)}</span>
        <span>{dateLabel(sorted.at(-1).measured_at)}</span>
      </div>
      {hasSecondary && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--vitals-primary)" }} />
            <span className="font-bold text-slate-700 dark:text-slate-300">{primaryLabel}</span>
            <span className="text-slate-500 dark:text-slate-400">{latestPrimary} {unit}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--vitals-secondary)" }} />
            <span className="font-bold text-slate-700 dark:text-slate-300">{secondaryLabel}</span>
            <span className="text-slate-500 dark:text-slate-400">{latestSecondary} {unit}</span>
          </div>
        </div>
      )}
    </div>
  );
}
