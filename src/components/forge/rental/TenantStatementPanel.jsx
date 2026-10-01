"use client";
import { useEffect, useMemo, useState } from "react";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const periodLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

// Statement months the tenant can pick: the current month plus the 11 before it.
export function statementPeriodOptions(count = 12, now = new Date()) {
  const options = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
    options.push({ value, label: periodLabel.format(at) });
  }
  return options;
}

export function formatStatementDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : date.format(parsed);
}

// Tenant portal statement view — Rentec parity R14. Same ledger the owner sees,
// period-sliced by the tenant-selected month, printable. Print styling follows
// the owner statement panel: interactive chrome hides in print, the document
// itself prints clean.
export default function TenantStatementPanel() {
  const options = useMemo(() => statementPeriodOptions(), []);
  const [period, setPeriod] = useState(options[0].value);
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    fetch(`/api/rental/portal/statement?period=${period}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load your statement.");
        return body.statement;
      })
      .then((loaded) => { if (!cancelled) { setStatement(loaded); setLoading(false); } })
      .catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "Unable to load your statement."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [period]);
  return <section aria-label="Your rent statement" className="rounded-2xl border bg-white p-6 shadow-sm print:border-0 print:shadow-none print:p-0">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Your rent statement</p>
        <h2 className="mt-2 text-xl font-black text-slate-950">Account statement</h2>
        {statement ? <p className="mt-1 text-sm text-slate-500">
          {statement.tenantName}{[statement.propertyLabel, statement.unitLabel].filter(Boolean).join(" · ") ? ` — ${[statement.propertyLabel, statement.unitLabel].filter(Boolean).join(" · ")}` : ""}
        </p> : null}
        {statement ? <p className="mt-1 text-sm font-bold text-slate-700">
          {statement.period.label} <span className="font-normal text-slate-500">({formatStatementDate(statement.period.start)} – {formatStatementDate(statement.period.end)})</span>
        </p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="sr-only" htmlFor="tenant-statement-period">Statement period</label>
        <select id="tenant-statement-period" value={period} onChange={(event) => setPeriod(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          Print or save as PDF
        </button>
      </div>
    </div>
    {loading ? <p role="status" className="mt-6 text-sm text-slate-500">Loading your statement…</p> : null}
    {!loading && error ? <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800">{error}</p> : null}
    {!loading && !error && statement ? (
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Statement for {statement.period.label}</caption>
          <thead>
            <tr className="border-b text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-2 pr-3">Date</th>
              <th scope="col" className="py-2 pr-3">Description</th>
              <th scope="col" className="py-2 pr-3 text-right">Charge</th>
              <th scope="col" className="py-2 pr-3 text-right">Payment</th>
              <th scope="col" className="py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-2 pr-3 font-bold" colSpan={4}>Opening balance</td>
              <td className="py-2 text-right font-black">{money.format(statement.openingBalanceCents / 100)}</td>
            </tr>
            {statement.entries.length === 0 ? (
              <tr><td colSpan={5} className="py-6 text-center text-slate-500">No activity in {statement.period.label}.</td></tr>
            ) : statement.entries.map((line) => <tr key={line.id} className="border-b">
              <td className="py-2 pr-3 whitespace-nowrap">{formatStatementDate(line.date)}</td>
              <td className="py-2 pr-3">
                <span className="font-bold">{line.label}</span>
                {line.status && !["due", "succeeded", "applied", "paid"].includes(line.status) ? (
                  <span className="ml-2 text-xs capitalize text-slate-500">{line.status.replaceAll("_", " ")}</span>
                ) : null}
                {line.kind === "credit" && line.remainingCents ? (
                  <span className="ml-2 text-xs text-slate-500">{money.format(line.remainingCents / 100)} still available</span>
                ) : null}
              </td>
              <td className="py-2 pr-3 text-right">{line.debitCents ? money.format(line.debitCents / 100) : "—"}</td>
              <td className="py-2 pr-3 text-right">{line.creditCents ? money.format(line.creditCents / 100) : "—"}</td>
              <td className="py-2 text-right font-bold">{money.format(line.balanceAfterCents / 100)}</td>
            </tr>)}
            <tr>
              <td className="py-2 pr-3 font-black" colSpan={4}>Closing balance</td>
              <td className="py-2 text-right text-base font-black">{money.format(statement.closingBalanceCents / 100)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    ) : null}
  </section>;
}
