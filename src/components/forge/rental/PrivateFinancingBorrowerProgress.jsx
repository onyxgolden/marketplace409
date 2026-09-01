"use client";

import { useMemo, useState } from "react";
import { compareBorrowerPayoffScenarios, projectBorrowerPayoff } from "@/domains/private-financing/borrowerPayoffProjection";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const dollars = (cents) => money.format(Number(cents || 0) / 100);
const displayDate = (iso) => date.format(new Date(`${iso}T00:00:00Z`));

function ProgressDonut({ originalPrincipalCents, summary }) {
  const paid = Math.max(summary.cashPrincipalPaidCents, 0);
  const credits = Math.max(summary.principalCreditsCents, 0);
  const remaining = Math.max(summary.principalRemainingCents, 0);
  const total = Math.max(originalPrincipalCents, paid + credits + remaining, 1);
  const paidEnd = (paid / total) * 100;
  const creditEnd = ((paid + credits) / total) * 100;
  const background = `conic-gradient(#0f766e 0 ${paidEnd}%, #d97706 ${paidEnd}% ${creditEnd}%, #cbd5e1 ${creditEnd}% 100%)`;
  return (
    <div className="grid gap-6 md:grid-cols-[15rem_1fr] md:items-center">
      <div
        role="img"
        aria-label={`Principal progress: ${dollars(paid)} paid, ${dollars(credits)} seller credits, ${dollars(remaining)} remaining.`}
        className="relative mx-auto h-56 w-56 rounded-full"
        style={{ background }}
      >
        <div className="absolute inset-10 grid place-content-center rounded-full bg-white text-center shadow-inner">
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Remaining</span>
          <strong className="mt-1 text-2xl text-slate-950">{dollars(remaining)}</strong>
        </div>
      </div>
      <dl className="space-y-3">
        <Legend color="bg-teal-700" label="Cash principal paid" value={dollars(paid)} />
        <Legend color="bg-amber-600" label="Seller principal credits" value={dollars(credits)} />
        <Legend color="bg-slate-300" label="Principal remaining" value={dollars(remaining)} />
        <div className="border-t pt-3">
          <dt className="text-xs font-bold uppercase text-slate-500">Balance calculated as of</dt>
          <dd className="mt-1 font-black">{displayDate(summary.asOfDate)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Legend({ color, label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2 text-sm font-semibold text-slate-700"><span className={`h-3 w-3 rounded-full ${color}`} />{label}</dt>
      <dd className="font-black text-slate-950">{value}</dd>
    </div>
  );
}

function PayoffLines({ baseline, scenario }) {
  const width = 640;
  const height = 220;
  const padding = 24;
  const maxPayments = Math.max(baseline.paymentCount, scenario.paymentCount, 1);
  const maxBalance = Math.max(baseline.balanceSeries[0]?.principalRemainingCents || 1, 1);
  const points = (series) => series.map((point) => {
    const x = padding + (point.paymentNumber / maxPayments) * (width - padding * 2);
    const y = padding + (1 - point.principalRemainingCents / maxBalance) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Projected principal balance comparison" className="min-w-[36rem]">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#94a3b8" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#94a3b8" />
        <polyline points={points(baseline.balanceSeries)} fill="none" stroke="#64748b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={points(scenario.balanceSeries)} fill="none" stroke="#0f766e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex flex-wrap gap-5 text-sm font-bold">
        <span className="flex items-center gap-2"><span className="h-1 w-8 bg-slate-500" />Current payment</span>
        <span className="flex items-center gap-2"><span className="h-1 w-8 bg-teal-700" />Selected payment</span>
      </div>
    </div>
  );
}

export default function PrivateFinancingBorrowerProgress({ account, summary, regularScheduledPaymentCents, projection }) {
  const [paymentCents, setPaymentCents] = useState(regularScheduledPaymentCents);
  const maxPaymentCents = Math.max(regularScheduledPaymentCents * 3, regularScheduledPaymentCents + 100_000);
  const scenarioState = useMemo(() => {
    if (!projection) return { scenario: null, error: "" };
    try {
      return { scenario: projectBorrowerPayoff({ ...projection.seed, paymentAmountCents: paymentCents }), error: "" };
    } catch (error) {
      return { scenario: null, error: error.message };
    }
  }, [paymentCents, projection]);
  const comparison = scenarioState.scenario ? compareBorrowerPayoffScenarios(projection.baseline, scenarioState.scenario) : null;

  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby={`progress-${account.id}`} className="rounded-2xl bg-slate-50 p-5">
        <h3 id={`progress-${account.id}`} className="text-lg font-black">Your principal progress</h3>
        <p className="mt-1 text-sm text-slate-600">Interest is shown separately because future interest changes with payment timing and amount.</p>
        <div className="mt-5"><ProgressDonut originalPrincipalCents={account.origination_principal_cents} summary={summary} /></div>
      </section>

      <section aria-labelledby={`interest-${account.id}`} className="rounded-2xl border p-5">
        <h3 id={`interest-${account.id}`} className="text-lg font-black">Interest summary</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Fact label="Interest paid to date" value={dollars(summary.interestPaidCents)} />
          <Fact label="Accrued, not yet paid" value={dollars(summary.accruedUnpaidInterestCents)} />
          <Fact label="Projected future interest" value={projection ? dollars(projection.baseline.projectedFutureInterestCents) : "Unavailable"} />
        </dl>
      </section>

      {projection ? (
        <section aria-labelledby={`simulator-${account.id}`} className="rounded-2xl border border-teal-200 bg-teal-50/50 p-5">
          <h3 id={`simulator-${account.id}`} className="text-lg font-black">See how paying more could help</h3>
          <p className="mt-1 text-sm text-slate-700">This calculator is an estimate. It does not change your required payment or loan terms and does not submit a payment.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_10rem] md:items-end">
            <label className="font-bold">
              Monthly payment
              <input
                aria-label="Projected monthly payment slider"
                type="range"
                min={regularScheduledPaymentCents}
                max={maxPaymentCents}
                step={1_000}
                value={paymentCents}
                onChange={(event) => setPaymentCents(Number(event.target.value))}
                className="mt-3 w-full accent-teal-700"
              />
            </label>
            <label className="text-sm font-bold">
              Exact amount
              <input
                aria-label="Projected monthly payment amount"
                type="number"
                min={(regularScheduledPaymentCents / 100).toFixed(2)}
                step="10"
                value={(paymentCents / 100).toFixed(2)}
                onChange={(event) => setPaymentCents(Math.max(regularScheduledPaymentCents, Math.round(Number(event.target.value || 0) * 100)))}
                className="mt-1 w-full rounded-lg border bg-white p-2"
              />
            </label>
          </div>
          {scenarioState.error ? <p role="alert" className="mt-4 font-bold text-red-700">{scenarioState.error}</p> : null}
          {scenarioState.scenario ? (
            <>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Estimated payoff" value={displayDate(scenarioState.scenario.payoffDate)} />
                <Fact label="Payments remaining" value={scenarioState.scenario.paymentCount} />
                <Fact label="Projected interest" value={dollars(scenarioState.scenario.projectedFutureInterestCents)} />
                <Fact label="Interest saved" value={dollars(comparison.interestSavedCents)} accent />
                <Fact label="Time saved" value={comparison.paymentsSaved === 1 ? "1 month" : `${comparison.paymentsSaved} months`} accent />
              </dl>
              <div className="mt-6"><PayoffLines baseline={projection.baseline} scenario={scenarioState.scenario} /></div>
            </>
          ) : null}
        </section>
      ) : (
        <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-700">A payoff simulation is not available for this account’s current payment terms.</p>
      )}
    </div>
  );
}

function Fact({ label, value, accent = false }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
      <dd className={`mt-1 text-lg font-black ${accent ? "text-teal-800" : "text-slate-950"}`}>{value}</dd>
    </div>
  );
}
