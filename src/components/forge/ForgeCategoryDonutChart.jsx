"use client";
import { useMemo, useState } from "react";
import { categoricalSlotVar, metallicCategoricalTokensClassName } from "./forgeMetallicTheme";

const CIRCLE_R = 42;
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R;
const STROKE_WIDTH = 15;
const ACTIVE_STROKE_WIDTH = STROKE_WIDTH + 4;
const GAP_PX = 2; // 2px surface gap between adjacent slices, per FORGE chart mark spec

function formatPercent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

// Plain (non-component) helper so the cumulative-offset walk can use an ordinary local mutable
// variable -- inside a component/hook body, React Compiler flags that pattern as an unsafe
// reassignment, even when (as here) it never escapes a single synchronous pass.
function positionSlices(slices, total) {
  const positioned = [];
  let cumulative = 0;
  for (const [index, slice] of slices.entries()) {
    const fraction = total > 0 ? slice.valueCents / total : 0;
    const arcLength = Math.max(0, fraction * CIRCUMFERENCE - GAP_PX);
    positioned.push({ ...slice, fraction, arcLength, offset: -cumulative, color: categoricalSlotVar(index) });
    cumulative += fraction * CIRCUMFERENCE;
  }
  return positioned;
}

// Category-share donut: identity color per category (validated categorical palette, see
// forgeMetallicTheme.js), fixed hue order, direct percentage figures on every slice via the
// always-present legend list (required "relief" since 3 of the 8 slots fall below 3:1 contrast on
// the light surface). A native <title> gives every slice a zero-JS hover/focus tooltip; hovering
// either the arc or its legend row highlights both, so identity is never color-alone.
export default function ForgeCategoryDonutChart({ title, slices = [], formatValue, emptyLabel = "No activity in this period." }) {
  const [activeKey, setActiveKey] = useState(null);
  const format = formatValue || ((cents) => String(cents));

  const total = useMemo(() => slices.reduce((sum, slice) => sum + slice.valueCents, 0), [slices]);
  const positioned = useMemo(() => positionSlices(slices, total), [slices, total]);

  return (
    <div className={metallicCategoricalTokensClassName}>
      <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h4>
      {total === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0" role="img" aria-label={`${title}: ${format(total)} total`}>
            <g transform="rotate(-90 60 60)">
              <circle cx="60" cy="60" r={CIRCLE_R} fill="none" strokeWidth={STROKE_WIDTH} className="stroke-slate-100 dark:stroke-slate-800" />
              {positioned.map((slice) => (
                <circle
                  key={slice.key}
                  data-donut-slice={slice.key}
                  cx="60" cy="60" r={CIRCLE_R} fill="none"
                  stroke={slice.color}
                  strokeWidth={activeKey === slice.key ? ACTIVE_STROKE_WIDTH : STROKE_WIDTH}
                  strokeDasharray={`${slice.arcLength} ${CIRCUMFERENCE - slice.arcLength}`}
                  strokeDashoffset={slice.offset}
                  strokeLinecap="round"
                  className="cursor-pointer transition-[stroke-width] motion-reduce:transition-none"
                  tabIndex={0}
                  onMouseEnter={() => setActiveKey(slice.key)}
                  onMouseLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(slice.key)}
                  onBlur={() => setActiveKey(null)}
                >
                  <title>{`${slice.label}: ${format(slice.valueCents)} (${formatPercent(slice.fraction)})`}</title>
                </circle>
              ))}
            </g>
            <text x="60" y="57" textAnchor="middle" className="fill-slate-900 dark:fill-slate-100" style={{ font: "800 11px system-ui, sans-serif" }}>
              {format(total)}
            </text>
            <text x="60" y="70" textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" style={{ font: "700 7px system-ui, sans-serif" }}>
              TOTAL
            </text>
          </svg>

          <ul aria-label={title} className="w-full min-w-0 space-y-1">
            {positioned.map((slice) => (
              <li
                key={slice.key}
                data-donut-legend-row={slice.key}
                onMouseEnter={() => setActiveKey(slice.key)}
                onMouseLeave={() => setActiveKey(null)}
                className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition-colors motion-reduce:transition-none ${
                  activeKey === slice.key ? "bg-slate-50 dark:bg-slate-800/60" : ""
                }`}
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 flex-1 truncate font-bold text-slate-800 dark:text-slate-200">{slice.label}</span>
                <span className="shrink-0 font-black tabular-nums text-slate-900 dark:text-slate-100">{format(slice.valueCents)}</span>
                <span className="w-9 shrink-0 text-right font-bold tabular-nums text-slate-500 dark:text-slate-400">{formatPercent(slice.fraction)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
