// Manpower curve panel (work package planner, slice 6).
//
// A derived view only: required labor by craft and outage day, computed on
// the server from the active work-step plan against the package's frozen
// baseline, with craft-assignment staffing shown as an overlay. This panel
// never edits step hours, duration, or craft, never assigns workers, and
// never mutates progress — it only sets each step's explicit start day
// (which days receive the step's hours). All totals on screen are
// server-computed; the panel renders them, it does not re-derive the curve
// in the browser. Person-hours are the only unit shown: there is no
// persisted hours/person-day rule and no equivalent-persons display.

import { useMemo, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

const CHART_COLORS = [
  "#0f766e", "#1d4ed8", "#b45309", "#be185d", "#4d7c0f",
  "#6d28d9", "#0e7490", "#b91c1c", "#334155", "#a16207",
];

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric",
    });
  } catch {
    return String(value);
  }
}

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatHours(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(2)}`;
}

// SVG line chart: X = outage day, Y = required person-hours per day. One
// line per visible craft, plus a dashed total-capacity overlay. No chart
// library — plain SVG.
function CurveChart({ days, crafts, visibleCrafts, showCapacity }) {
  const width = 720;
  const height = 260;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const dayCount = days.length;
  if (dayCount === 0) return null;

  const valueFor = (day, craftKey) => {
    const cell = day.crafts[craftKey];
    if (!cell) return 0;
    return cell.requiredHours;
  };
  const capacityFor = (day) => day.totalAssignedHours;

  let maxValue = 0;
  for (const day of days) {
    for (const craftKey of visibleCrafts) maxValue = Math.max(maxValue, valueFor(day, craftKey));
    if (showCapacity) maxValue = Math.max(maxValue, capacityFor(day));
  }
  if (maxValue <= 0) maxValue = 1;
  const top = maxValue * 1.1;

  const xFor = (index) => padLeft + (dayCount === 1 ? plotWidth / 2 : (index / (dayCount - 1)) * plotWidth);
  const yFor = (value) => padTop + plotHeight - (value / top) * plotHeight;
  const pointsFor = (values) => values.map((value, i) => `${xFor(i).toFixed(1)},${yFor(value).toFixed(1)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: top * fraction,
    y: yFor(top * fraction),
  }));
  const xTicks = days.filter((_, i) => dayCount <= 31 || i % Math.ceil(dayCount / 31) === 0 || i === dayCount - 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Manpower curve chart">
      {yTicks.map((tick) => (
        <g key={tick.value}>
          <line x1={padLeft} x2={width - padRight} y1={tick.y} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
          <text x={padLeft - 6} y={tick.y + 4} textAnchor="end" fontSize="10" fill="#64748b">
            {tick.value.toFixed(1)}
          </text>
        </g>
      ))}
      {xTicks.map((day) => (
        <text key={day.dayIndex} x={xFor(day.dayIndex - 1)} y={height - 12} textAnchor="middle" fontSize="10" fill="#64748b">
          {`D${day.dayIndex}`}
        </text>
      ))}
      {crafts.map((craft, index) => {
        if (!visibleCrafts.includes(craft.craftKey)) return null;
        const color = CHART_COLORS[index % CHART_COLORS.length];
        return (
          <polyline
            key={craft.craftKey}
            points={pointsFor(days.map((day) => valueFor(day, craft.craftKey)))}
            fill="none"
            stroke={color}
            strokeWidth="2"
          />
        );
      })}
      {showCapacity && (
        <polyline
          points={pointsFor(days.map((day) => capacityFor(day)))}
          fill="none"
          stroke="#64748b"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
      )}
      <text x={padLeft} y={12} fontSize="11" fill="#334155">
        Required person-hours per day
      </text>
    </svg>
  );
}

function PlacementControl({ packageId, step, outageDays, baselineVersion, readOnly, onSaved }) {
  const placement = step.placement;
  const [startDay, setStartDay] = useState(placement ? String(placement.startDayIndex) : "1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function onSet(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/work-packages/${packageId}/manpower-curve/placements`, {
        method: "PUT",
        body: JSON.stringify({
          stepId: step.stepId,
          baselineVersion,
          startDayIndex: Number(startDay),
          expectedVersion: placement?.version ?? 0,
          reason: reason.trim() === "" ? null : reason.trim(),
        }),
      });
      setMessage("Placement saved — the step now starts on that outage day.");
      onSaved();
    } catch (error) {
      setMessage(error.message || "The placement could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/work-packages/${packageId}/manpower-curve/placements/${placement.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: placement.version, reason: reason.trim() }),
      });
      setMessage("Placement cleared — the step is back on the unsequenced baseline.");
      onSaved();
    } catch (error) {
      setMessage(error.message || "The placement could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    return (
      <span className="text-xs text-slate-500">
        {placement ? `Starts outage day ${placement.startDayIndex}` : "Unsequenced baseline"}
      </span>
    );
  }

  return (
    <form onSubmit={onSet} className="flex flex-wrap items-end gap-2">
      <div>
        <label className={label} htmlFor={`placement-${step.stepId}`}>Start day</label>
        <select id={`placement-${step.stepId}`} className={input} value={startDay}
          onChange={(e) => setStartDay(e.target.value)}>
          {Array.from({ length: outageDays }, (_, i) => (
            <option key={i + 1} value={String(i + 1)}>
              {`Day ${i + 1}`}
            </option>
          ))}
        </select>
      </div>
      {placement && (
        <div>
          <label className={label} htmlFor={`placement-reason-${step.stepId}`}>Reason (required to move)</label>
          <input id={`placement-reason-${step.stepId}`} className={input} type="text" maxLength={1000}
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the start day changed" />
        </div>
      )}
      <button className={btnPrimary} type="submit" disabled={busy}>
        {placement ? "Move start day" : "Set start day"}
      </button>
      {placement && (
        <button className={btnGhost} type="button" disabled={busy} onClick={onClear}>
          Clear placement
        </button>
      )}
      {message && <span className="w-full text-xs text-slate-600">{message}</span>}
    </form>
  );
}

export default function WorkPackageManpowerCurve({ packageId }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:manpower-curve:${refreshKey}`,
    () => api(`/api/work-packages/${packageId}/manpower-curve`),
    { ttlMs: 10_000 },
  );
  const [showCapacity, setShowCapacity] = useState(true);
  const [hiddenCrafts, setHiddenCrafts] = useState([]);
  const [exportMessage, setExportMessage] = useState("");

  const refreshCurve = () => {
    setRefreshKey((key) => key + 1);
    refresh();
  };

  const curve = data ?? null;
  const windowConfigured = curve?.windowConfigured === true;
  // When no baseline is frozen the panel body below already states the
  // frozen-baseline message, so the matching warning would print it a
  // second time. Other warnings still render normally.
  const visibleWarnings = (curve?.warnings ?? []).filter(
    (warning) => windowConfigured || warning.code !== "BASELINE_NOT_FROZEN",
  );
  const readOnly = curve?.packageStatus === "cancelled" || curve?.packageStatus === "verified_closed";
  const allocatableCrafts = useMemo(
    () => (curve?.crafts ?? []).filter((craft) => craft.craftKey !== null),
    [curve],
  );
  const visibleCrafts = useMemo(
    () => allocatableCrafts.map((craft) => craft.craftKey).filter((key) => !hiddenCrafts.includes(key)),
    [allocatableCrafts, hiddenCrafts],
  );

  const dailyRows = useMemo(() => {
    if (!curve) return [];
    const rows = [];
    for (const day of curve.days) {
      for (const craftKey of Object.keys(day.crafts)) {
        const cell = day.crafts[craftKey];
        rows.push({ dayIndex: day.dayIndex, date: day.date, ...cell });
      }
    }
    return rows;
  }, [curve]);

  function toggleCraft(craftKey) {
    setHiddenCrafts((hidden) =>
      hidden.includes(craftKey) ? hidden.filter((key) => key !== craftKey) : [...hidden, craftKey],
    );
  }

  function exportCsv() {
    if (!curve) return;
    const lines = [
      `# Manpower curve — package ${packageId}`,
      `# Baseline v${curve.baseline?.versionNumber ?? "?"}: ${curve.window?.outageStartDate ?? "not set"} to ${curve.window?.outageEndDate ?? "not set"} (${curve.window?.outageDays ?? 0} days)`,
      `# Computed at: ${curve.computedAt ?? ""}`,
      `# ${curve.baselineDisclosure}`,
      "day,date,craft,required_hours,assigned_hours,gap_hours",
    ];
    for (const row of dailyRows) {
      lines.push([
        row.dayIndex, row.date, `"${String(row.craftLabel).replace(/"/g, '""')}"`,
        row.requiredHours, row.assignedHours, row.gapHours,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `manpower-curve-${packageId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setExportMessage("CSV downloaded.");
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Manpower curve</h2>
          <p className="mt-1 text-xs text-slate-500">
            Required labor by craft and outage day, from the active work-step plan against the package&apos;s frozen
            baseline. Craft-assignment staffing is shown as a capacity overlay — it never moves demand. {curve?.baselineDisclosure}
          </p>
        </div>
        {curve && windowConfigured && (
          <button className={btnGhost} type="button" onClick={exportCsv}>
            Download CSV
          </button>
        )}
      </div>

      {isLoading && !curve && <p className="mt-3 text-sm text-slate-500">Loading the manpower curve…</p>}
      {error && !curve && <p className="mt-3 text-sm text-red-600">{error.message || "The manpower curve could not be loaded."}</p>}

      {curve?.notApplied && (
        <p className="mt-3 text-sm text-slate-600">
          The manpower curve isn&apos;t available yet — the database change for this feature hasn&apos;t been applied.
        </p>
      )}

      {curve && !curve.notApplied && (
        <>
          {visibleWarnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {visibleWarnings.map((warning) => (
                <li key={warning.code} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {warning.message}
                </li>
              ))}
            </ul>
          )}

          {windowConfigured ? (
            <div className="mt-3 text-xs text-slate-600">
              <span>Baseline v{curve.baseline.versionNumber}</span>
              <span className="mx-2">·</span>
              <span>Outage: {formatDate(curve.window.outageStartDate)} – {formatDate(curve.window.outageEndDate)}</span>
              <span className="mx-2">·</span>
              <span>{curve.window.outageDays} days</span>
              <span className="mx-2">·</span>
              <span>Computed {formatWhen(curve.computedAt)}</span>
              {readOnly && <span className="mx-2">·</span>}
              {readOnly && <span>Read-only — this package is closed.</span>}
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-slate-600">
                Freeze/select a package baseline first — the curve is drawn from the package&apos;s frozen baseline, and no dates are assumed.
              </p>
            </div>
          )}

          {windowConfigured && (
            <>
              {curve.days.length === 0 || curve.steps.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">No planned steps — add work steps to see demand on the curve.</p>
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">Crafts:</span>
                    {allocatableCrafts.map((craft, index) => {
                      const hidden = hiddenCrafts.includes(craft.craftKey);
                      return (
                        <button
                          key={craft.craftKey}
                          type="button"
                          className={`${btn} border ${hidden ? "border-slate-200 text-slate-400" : "border-slate-300 text-slate-700"}`}
                          onClick={() => toggleCraft(craft.craftKey)}
                          aria-pressed={!hidden}
                        >
                          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                          {craft.craftLabel}
                        </button>
                      );
                    })}
                    <button type="button" className={`${btn} border border-slate-300 text-slate-700`} onClick={() => setShowCapacity((v) => !v)} aria-pressed={showCapacity}>
                      {showCapacity ? "Hide capacity overlay" : "Show capacity overlay"}
                    </button>
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <CurveChart
                      days={curve.days}
                      crafts={allocatableCrafts}
                      visibleCrafts={visibleCrafts}
                      showCapacity={showCapacity}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Solid lines: required person-hours per craft.
                      {showCapacity && " Dashed line: total assigned capacity."} X axis: outage day (day 1 is the baseline start date).
                    </p>
                  </div>

                  <h3 className="mt-5 text-xs font-semibold text-slate-900">Daily demand by craft</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3">Day</th>
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Craft</th>
                          <th className="py-2 pr-3 text-right">Required hrs</th>
                          <th className="py-2 pr-3 text-right">Assigned hrs</th>
                          <th className="py-2 text-right">Gap hrs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyRows.map((row) => (
                          <tr key={`${row.dayIndex}-${row.craftKey}`} className="border-b border-slate-100">
                            <td className="py-1.5 pr-3">{row.dayIndex}</td>
                            <td className="py-1.5 pr-3">{formatDate(row.date)}</td>
                            <td className="py-1.5 pr-3">{row.craftLabel}</td>
                            <td className="py-1.5 pr-3 text-right">{formatHours(row.requiredHours)}</td>
                            <td className="py-1.5 pr-3 text-right">{formatHours(row.assignedHours)}</td>
                            <td className={`py-1.5 text-right ${row.gapHours < 0 ? "text-red-600" : ""}`}>{formatHours(row.gapHours)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h3 className="mt-5 text-xs font-semibold text-slate-900">Totals per craft</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3">Craft</th>
                          <th className="py-2 pr-3 text-right">Steps</th>
                          <th className="py-2 pr-3 text-right">Required hrs</th>
                          <th className="py-2 pr-3 text-right">Assigned hrs</th>
                          <th className="py-2 text-right">Gap hrs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {curve.crafts.map((craft) => (
                          <tr key={craft.craftKey ?? "unclassified"} className="border-b border-slate-100">
                            <td className="py-1.5 pr-3">{craft.craftLabel}</td>
                            <td className="py-1.5 pr-3 text-right">{craft.stepCount}</td>
                            <td className="py-1.5 pr-3 text-right">{formatHours(craft.totalRequiredHours)}</td>
                            <td className="py-1.5 pr-3 text-right">{formatHours(craft.totalAssignedHours)}</td>
                            <td className={`py-1.5 text-right ${craft.totalGapHours < 0 ? "text-red-600" : ""}`}>{formatHours(craft.totalGapHours)}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="py-1.5 pr-3">Total</td>
                          <td className="py-1.5 pr-3 text-right">{curve.totals.stepCount}</td>
                          <td className="py-1.5 pr-3 text-right">{formatHours(curve.totals.requiredHours)}</td>
                          <td className="py-1.5 pr-3 text-right">{formatHours(curve.totals.assignedHours)}</td>
                          <td className="py-1.5 text-right">{formatHours(curve.totals.gapHours)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-2 text-xs text-slate-500">
                    Reconciliation: daily required {formatHours(curve.reconciliation.requiredHoursTotal)} hrs
                    {" + "}unallocated known {formatHours(curve.reconciliation.unallocatedKnownHours)} hrs
                    {" + "}unclassified {formatHours(curve.reconciliation.unclassifiedKnownHours)} hrs
                    {" = "}known active step hours {formatHours(curve.reconciliation.knownActiveStepHours)} hrs
                    {curve.reconciliation.reconciled
                      ? " — fully reconciled."
                      : " — not fully reconciled while hours are excluded or unknown; see the excluded steps below."}
                  </p>
                  {exportMessage && <p className="mt-1 text-xs text-slate-600">{exportMessage}</p>}
                </>
              )}

              {curve.excludedSteps.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-slate-900">Excluded steps — not on the curve</h3>
                  <ul className="mt-2 space-y-2">
                    {curve.excludedSteps.map((step) => (
                      <li key={step.stepId} className="rounded-md border border-slate-200 px-3 py-2 text-xs">
                        <span className="font-medium text-slate-800">{step.title ?? "Untitled step"}</span>
                        <span className="text-slate-500"> — {step.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5">
                <h3 className="text-xs font-semibold text-slate-900">Step start days</h3>
                <p className="mt-1 text-xs text-slate-500">
                  A start day only moves which outage days receive a step&apos;s hours — it never changes the step&apos;s
                  hours, craft, or duration. Steps without a start day use the unsequenced baseline (days 1..duration).
                  Placements are bound to baseline v{curve.baseline.versionNumber}; a re-baseline does not carry them forward.
                </p>
                <ul className="mt-2 space-y-3">
                  {curve.steps.map((step) => (
                    <li key={step.stepId} className="rounded-md border border-slate-200 px-3 py-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="text-xs">
                          <span className="font-medium text-slate-800">{step.title ?? "Untitled step"}</span>
                          <span className="text-slate-500">
                            {` — ${step.craftLabel ?? "no craft"} · ${step.plannedPersonHours == null ? "no planned hours" : `${formatHours(step.plannedPersonHours)} hrs`} · ${step.plannedDurationDays == null ? "whole window" : `${step.plannedDurationDays} day${step.plannedDurationDays === 1 ? "" : "s"}`}`}
                          </span>
                          {step.excludedReason && (
                            <span className="block text-amber-700">
                              Not placed: {curve.excludedSteps.find((s) => s.stepId === step.stepId)?.detail ?? step.excludedReason}
                            </span>
                          )}
                          {step.placement && !step.excludedReason && (
                            <span className="block text-slate-500">
                              Currently starts outage day {step.placement.startDayIndex}
                              {step.placement.startDayIndex + (step.plannedDurationDays ?? curve.window.outageDays) - 1 <= curve.window.outageDays
                                ? ` (${formatDate(curve.days[step.placement.startDayIndex - 1]?.date)})`
                                : ""}
                            </span>
                          )}
                        </div>
                        {!step.excludedReason && (
                          <PlacementControl
                            packageId={packageId}
                            step={step}
                            outageDays={curve.window.outageDays}
                            baselineVersion={curve.baseline.versionNumber}
                            readOnly={readOnly}
                            onSaved={refreshCurve}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
