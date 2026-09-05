"use client";
import { useEffect, useState } from "react";

function formatCurrency(amount) {
  if (amount == null) return "—";
  return `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatRatio(value) {
  return value == null ? "—" : value.toFixed(2);
}
function formatPercent(value) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}
function Badge({ pass }) {
  if (pass == null) return <span className="text-slate-400">—</span>;
  return pass
    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Pass</span>
    : <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">Fail</span>;
}
function DcmaRow({ point, label, value, pass }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1 pr-2 text-slate-400">{point}</td>
      <td className="py-1 pr-2 font-bold">{label}</td>
      <td className="py-1 pr-2">{value}</td>
      <td className="py-1 pr-2"><Badge pass={pass} /></td>
    </tr>
  );
}

// Read-only, owner-only view over GET .../evm-dcma -- same gating as Costs (see SchedulingBoard.jsx
// and the SCHED-05 migration's no-public-select decision). A baseline picker is needed here (unlike
// Costs) because EVM's planned value and several DCMA points are meaningless without one to measure
// against -- defaults to the project's most recently captured baseline, matching the route's own
// default.
export default function SchedulingEvmDcmaModal({ projectId, onClose }) {
  const [baselines, setBaselines] = useState([]);
  const [baselineId, setBaselineId] = useState("");
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(`/api/forge/scheduling/${projectId}/baselines`);
      const result = await response.json().catch(() => ({}));
      if (!cancelled) setBaselines(result.baselines || []);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    (async () => {
      const query = new URLSearchParams({ asOfDate, ...(baselineId ? { baselineId } : {}) });
      const response = await fetch(`/api/forge/scheduling/${projectId}/evm-dcma?${query}`);
      const result = await response.json().catch(() => ({}));
      if (!cancelled) {
        setReport(response.ok ? result : null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, baselineId, asOfDate]);

  const evm = report?.evm;
  const dcma = report?.dcma;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-evm-dcma>
      <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">EVM &amp; DCMA</h2>
            <p className="mt-1 text-sm text-slate-500">Earned value performance and the DCMA 14-point schedule health assessment, measured against a captured baseline.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2.5">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            Baseline
            {/* Falls back to the server's own auto-selected baseline (report.baselineId, the most
                recently captured one) until the user explicitly picks a different one -- reading
                that straight from the report instead of syncing it back into baselineId avoids an
                extra, redundant fetch every time the page first loads. */}
            <select value={baselineId || report?.baselineId || ""} onChange={(e) => setBaselineId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs" data-scheduling-evm-baseline-select>
              {baselines.length === 0 && <option value="">No baselines captured</option>}
              {baselines.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            As of
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs" />
          </label>
        </div>

        {loading && <p className="mt-4 text-xs text-slate-400">Loading…</p>}
        {!loading && !report && <p className="mt-4 text-xs text-slate-400">Unable to load EVM/DCMA data for this project.</p>}

        {!loading && report && (
          <>
            <div className="mt-5">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Earned value</h3>
              <div className="mt-2 grid grid-cols-4 gap-3">
                {[["BAC", evm.bac], ["PV", evm.pv], ["EV", evm.ev], ["AC", evm.ac]].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-1 text-base font-black">{formatCurrency(value)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">CV / SV</p>
                  <p className={`mt-1 text-sm font-black ${evm.cv < 0 ? "text-red-600" : ""}`}>{formatCurrency(evm.cv)}</p>
                  <p className={`text-sm font-black ${evm.sv < 0 ? "text-red-600" : ""}`}>{formatCurrency(evm.sv)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">CPI / SPI</p>
                  <p className={`mt-1 text-sm font-black ${evm.cpi != null && evm.cpi < 1 ? "text-red-600" : ""}`}>{formatRatio(evm.cpi)}</p>
                  <p className={`text-sm font-black ${evm.spi != null && evm.spi < 1 ? "text-red-600" : ""}`}>{formatRatio(evm.spi)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">ETC / VAC</p>
                  <p className="mt-1 text-sm font-black">{formatCurrency(evm.etc)}</p>
                  <p className={`text-sm font-black ${evm.vac != null && evm.vac < 0 ? "text-red-600" : ""}`}>{formatCurrency(evm.vac)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">EAC (atypical / typical / CPI×SPI)</p>
                  <p className="mt-1 text-xs font-black">{formatCurrency(evm.eac.atypical)} / {formatCurrency(evm.eac.typical)} / {formatCurrency(evm.eac.cpiSpi)}</p>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">DCMA 14-point assessment</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="pr-2 font-bold">#</th><th className="pr-2 font-bold">Check</th><th className="pr-2 font-bold">Result</th><th className="pr-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <DcmaRow point={1} label="Logic" value={`${formatPercent(dcma.logic.percentMissing)} missing`} pass={dcma.logic.pass} />
                    <DcmaRow point={2} label="Leads" value={`${dcma.leadsAndLags.leads} found`} pass={dcma.leadsAndLags.leadsPass} />
                    <DcmaRow point={3} label="Lags" value={formatPercent(dcma.leadsAndLags.lagPercent)} pass={dcma.leadsAndLags.lagsPass} />
                    <DcmaRow point={4} label="Relationship types (FS)" value={formatPercent(dcma.relationshipTypes.fsPercent)} pass={dcma.relationshipTypes.pass} />
                    <DcmaRow point={5} label="Hard constraints" value={formatPercent(dcma.hardConstraints.percent)} pass={dcma.hardConstraints.pass} />
                    <DcmaRow point={6} label="High float (>44d)" value={formatPercent(dcma.float.highFloatPercent)} pass={dcma.float.highFloatPass} />
                    <DcmaRow point={7} label="Negative float" value={`${dcma.float.negativeFloatCount} activities`} pass={dcma.float.negativeFloatPass} />
                    <DcmaRow point={8} label="High duration (>44d)" value={formatPercent(dcma.duration.percent)} pass={dcma.duration.pass} />
                    <DcmaRow point={9} label="Invalid dates" value={`${dcma.invalidDates.invalidCount} activities`} pass={dcma.invalidDates.pass} />
                    <DcmaRow point={10} label="Resources assigned" value={formatPercent(dcma.resources.percent)} pass={null} />
                    <DcmaRow point={11} label="Missed tasks" value={`${dcma.missedTasks.missedCount} / ${dcma.missedTasks.dueCount} due`} pass={null} />
                    <DcmaRow point={12} label="Critical path test" value={dcma.criticalPathTest.reason || `${dcma.criticalPathTest.shiftDays ?? "—"}d shift`} pass={dcma.criticalPathTest.pass} />
                    <DcmaRow point={13} label="Critical path length index" value={formatRatio(dcma.cpli)} pass={null} />
                    <DcmaRow point={14} label="Baseline execution index" value={formatRatio(dcma.baselineExecutionIndex.bei)} pass={null} />
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
