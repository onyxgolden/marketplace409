"use client";
import { useId, useState } from "react";
import ForgeMetallicChartDefs, { metallicGradientUrl } from "./ForgeMetallicChartDefs";
import { metallicSwatchClassName, metallicTokensClassName } from "./forgeMetallicTheme";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
// Every date derivation here is UTC-in/UTC-out — no local Date object round-trips.
function pointLabel(key) {
  if (key.length === 4) return key;
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
}
function fullPeriodLabel(key) {
  if (key.length === 4) return key;
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function compactCurrency(cents) {
  const dollars = cents / 100;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

const VB_W = 720;
const VB_H = 260;
const PAD_LEFT = 52;
const PAD_RIGHT = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PLOT_W = VB_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VB_H - PAD_TOP - PAD_BOTTOM;
const ZERO_Y = PAD_TOP + PLOT_H / 2;
const HALF_H = PLOT_H / 2;
const SCROLL_THRESHOLD = 12; // 6M(6)/YTD(<=12)/Year(12) always fit; only a large All-time series scrolls.
const MIN_ITEM_WIDTH_PX = 44;

// True zero-axis financial chart: collected bars rise above zero, expense bars fall below zero,
// net cash flow is an overlaid line with markers on the same scale — the standard convention for
// comparing income against expenses at a glance (see Jason's Quicken reference; no branding or
// layout copied from it, only the zero-axis + net-line structure). Exact values are never
// permanently printed on the chart itself — they live in a hover/keyboard-focus tooltip and in an
// always-present accessible table, so the visual stays uncluttered while every number stays
// available to every user. Visual surfaces (bars, net line/marker) carry FORGE's restrained
// metallic treatment via forgeMetallicTheme.js's shared tokens — text stays flat and solid, per
// that system's own rule that metallic effects belong on data marks, never body copy. Domain-
// agnostic and reusable (Financial FORGE's own income/expense view, for example).
export default function ForgeComparisonBarChart({
  title = "Comparison", series = [], primaryLabel = "Primary", secondaryLabel = "Secondary", netLabel = "Net",
  formatValue, formatAxisValue = compactCurrency, currentKey = null,
}) {
  const format = formatValue || ((cents) => String(cents));
  const [activeIndex, setActiveIndex] = useState(null);
  const rawId = useId();
  const idPrefix = `fmc${rawId.replace(/[^a-zA-Z0-9]/g, "")}-`;
  const hasData = series.some((point) => point.primaryCents !== 0 || point.secondaryCents !== 0);
  const scaleMax = Math.max(1, ...series.flatMap((point) => [point.primaryCents, point.secondaryCents]));
  const scrollable = series.length > SCROLL_THRESHOLD;
  const colW = PLOT_W / Math.max(1, series.length);
  const barW = Math.min(colW * 0.42, 26);

  function xCenter(index) { return PAD_LEFT + colW * index + colW / 2; }
  function barTop(cents) { return ZERO_Y - (cents / scaleMax) * HALF_H; }

  const gridFractions = [1, 0.5, 0, -0.5, -1];
  const activePoint = activeIndex != null ? series[activeIndex] : null;
  const activeNet = activePoint ? activePoint.primaryCents - activePoint.secondaryCents : 0;

  return (
    <div data-comparison-chart className={metallicTokensClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-600 dark:text-slate-400">{title}</h3>
        <ul className="flex items-center gap-4" aria-hidden="true">
          <li className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${metallicSwatchClassName.income}`} />{primaryLabel}
          </li>
          <li className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${metallicSwatchClassName.expense}`} />{secondaryLabel}
          </li>
          <li className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400">
            <span className={`inline-block h-1 w-3.5 rounded-full ${metallicSwatchClassName.net}`} />{netLabel}
          </li>
        </ul>
      </div>

      {!hasData ? (
        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No recorded activity yet for this period.</p>
      ) : (
        <div className={`relative mt-4 ${scrollable ? "overflow-x-auto pb-1" : ""}`} data-chart-scrollable={scrollable}>
          <div style={scrollable ? { minWidth: `${series.length * MIN_ITEM_WIDTH_PX}px` } : undefined}>
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="group" aria-label={`${title}. Exact values are listed in the table below the chart.`} className="w-full" style={{ height: "auto" }}>
              <ForgeMetallicChartDefs prefix={idPrefix} />
              <rect x={PAD_LEFT} y={PAD_TOP} width={PLOT_W} height={PLOT_H} rx="6" fill={metallicGradientUrl(idPrefix, "panel")} />

              {gridFractions.map((fraction) => {
                const y = ZERO_Y - fraction * HALF_H;
                return (
                  <g key={fraction}>
                    <line x1={PAD_LEFT} x2={VB_W - PAD_RIGHT} y1={y} y2={y}
                      className={fraction === 0 ? "stroke-slate-400 dark:stroke-slate-500" : "stroke-slate-300/70 dark:stroke-slate-600/70"}
                      strokeWidth={fraction === 0 ? 1.5 : 1} />
                    <text x={PAD_LEFT - 6} y={y} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 dark:fill-slate-400 text-[9px] font-semibold">
                      {formatAxisValue(fraction * scaleMax)}
                    </text>
                  </g>
                );
              })}

              {series.map((point, index) => {
                const cx = xCenter(index);
                const collectedY = barTop(point.primaryCents);
                const expenseHeight = (point.secondaryCents / scaleMax) * HALF_H;
                const isCurrent = currentKey != null && point.key === currentKey;
                return (
                  <g key={point.key} data-comparison-point={point.key} data-comparison-current={isCurrent || undefined}>
                    <rect data-comparison-bar="primary" x={cx - barW / 2} y={collectedY} width={barW} height={ZERO_Y - collectedY} rx="2"
                      fill={metallicGradientUrl(idPrefix, "income")} stroke="var(--forge-metal-income-lo)" strokeWidth="0.75" />
                    <rect data-comparison-bar="secondary" x={cx - barW / 2} y={ZERO_Y} width={barW} height={expenseHeight} rx="2"
                      fill={metallicGradientUrl(idPrefix, "expense")} stroke="var(--forge-metal-expense-lo)" strokeWidth="0.75" />
                    <text x={cx} y={VB_H - 8} textAnchor="middle" className={`text-[10px] font-bold ${isCurrent ? "fill-sky-700 dark:fill-sky-400" : "fill-slate-500 dark:fill-slate-400"}`}>
                      {pointLabel(point.key)}
                    </text>
                  </g>
                );
              })}

              <polyline
                fill="none" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" stroke={metallicGradientUrl(idPrefix, "netLine")}
                points={series.map((point, index) => `${xCenter(index)},${barTop(point.primaryCents - point.secondaryCents)}`).join(" ")}
              />
              {series.map((point, index) => (
                <circle key={point.key} cx={xCenter(index)} cy={barTop(point.primaryCents - point.secondaryCents)} r="3.5"
                  fill={metallicGradientUrl(idPrefix, "netDot")} stroke="var(--forge-metal-net-b)" strokeWidth="1.25" />
              ))}

              {series.map((point, index) => (
                <rect
                  key={point.key} data-comparison-target={point.key} x={PAD_LEFT + colW * index} y={PAD_TOP} width={colW} height={PLOT_H}
                  fill="transparent" tabIndex={0} role="button"
                  aria-label={`${fullPeriodLabel(point.key)}: ${primaryLabel} ${format(point.primaryCents)}, ${secondaryLabel} ${format(point.secondaryCents)}, ${netLabel} ${format(point.primaryCents - point.secondaryCents)}`}
                  className="cursor-pointer outline-none focus-visible:fill-slate-900/5 dark:focus-visible:fill-white/10"
                  onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex((current) => (current === index ? null : current))}
                  onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
                  onClick={() => setActiveIndex((current) => (current === index ? null : index))}
                />
              ))}
            </svg>
          </div>

          {activePoint ? (
            <div
              data-comparison-tooltip role="status"
              className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
              style={{ left: `${(xCenter(activeIndex) / VB_W) * 100}%` }}
            >
              <p className="font-black text-slate-950 dark:text-white">{fullPeriodLabel(activePoint.key)}</p>
              <p className="mt-1 flex items-center justify-between gap-4 text-emerald-700 dark:text-emerald-400"><span>{primaryLabel}</span><span className="font-black tabular-nums">{format(activePoint.primaryCents)}</span></p>
              <p className="flex items-center justify-between gap-4 text-amber-700 dark:text-amber-400"><span>{secondaryLabel}</span><span className="font-black tabular-nums">{format(activePoint.secondaryCents)}</span></p>
              <p className="mt-1 flex items-center justify-between gap-4 border-t border-slate-200 pt-1 text-cyan-700 dark:border-slate-700 dark:text-cyan-400"><span>{netLabel}</span><span className="font-black tabular-nums">{activeNet < 0 ? `-${format(Math.abs(activeNet))}` : format(activeNet)}</span></p>
            </div>
          ) : null}
        </div>
      )}

      {/* sr-only must wrap the table, not be applied to it directly — a <table> under the default
          table-layout:auto sizes to fit its content regardless of an explicit small width, so
          sr-only's clip-to-1px never actually takes hold on the table element itself and the
          real, multi-column table width leaks into the page's scrollable area. */}
      <div className="sr-only">
        <table>
          <caption>{title} — exact values by period</caption>
          <thead><tr><th scope="col">Period</th><th scope="col">{primaryLabel}</th><th scope="col">{secondaryLabel}</th><th scope="col">{netLabel}</th></tr></thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.key}>
                <th scope="row">{fullPeriodLabel(point.key)}</th>
                <td>{format(point.primaryCents)}</td>
                <td>{format(point.secondaryCents)}</td>
                <td>{point.primaryCents - point.secondaryCents < 0 ? `-${format(Math.abs(point.primaryCents - point.secondaryCents))}` : format(point.primaryCents - point.secondaryCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
