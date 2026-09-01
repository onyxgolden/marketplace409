"use client";

import { useMemo, useState } from "react";
import { buildAmortizationSchedule, compareAmortizationSchedules } from "@/domains/financial/amortizationSchedule";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (cents) => money.format(Number(cents || 0) / 100);
const LOAN_TYPES = ["Mortgage", "Auto", "Personal", "Student", "Equipment", "Other"];

function firstOfNextMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

function newScenario(index = 1) {
  return {
    id: `loan-${Date.now()}-${index}`,
    name: `Loan ${index}`,
    type: "Mortgage",
    principal: "300000",
    annualRate: "6.50",
    termYears: "30",
    termMonths: "0",
    firstPaymentDate: firstOfNextMonth(),
    recurringExtra: "0",
    oneTimeExtra: "0",
    oneTimeExtraMonth: "12",
  };
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function calculateScenario(scenario) {
  const input = {
    principalCents: cents(scenario.principal),
    annualRateBps: Math.round(Number(scenario.annualRate || 0) * 100),
    termMonths: Number(scenario.termYears || 0) * 12 + Number(scenario.termMonths || 0),
    startDate: scenario.firstPaymentDate,
  };
  const baseline = buildAmortizationSchedule(input);
  const accelerated = buildAmortizationSchedule({
    ...input,
    recurringExtraCents: cents(scenario.recurringExtra),
    oneTimeExtraCents: cents(scenario.oneTimeExtra),
    oneTimeExtraMonth: Number(scenario.oneTimeExtraMonth || 1),
  });
  return { baseline, accelerated, comparison: compareAmortizationSchedules(baseline, accelerated) };
}

export default function FinancialLoanToolsPanel() {
  const [scenarios, setScenarios] = useState(() => [newScenario()]);
  const update = (id, field, value) => setScenarios((current) => current.map((loan) => loan.id === id ? { ...loan, [field]: value } : loan));
  const addScenario = () => setScenarios((current) => current.length >= 4 ? current : [...current, newScenario(current.length + 1)]);
  const copyScenario = (source) => setScenarios((current) => current.length >= 4 ? current : [...current, { ...source, id: `loan-${Date.now()}-${current.length + 1}`, name: `${source.name} copy` }]);
  const removeScenario = (id) => setScenarios((current) => current.length === 1 ? current : current.filter((loan) => loan.id !== id));

  return (
    <section data-financial-loan-tools className="space-y-5 text-slate-950 dark:text-slate-100">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Financial tools</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black tracking-tight">Loan amortization</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">Compare fixed-rate monthly loans and see how recurring or one-time principal overpayments change payoff time and interest.</p>
          </div>
          <button type="button" onClick={addScenario} disabled={scenarios.length >= 4} className="rounded-xl bg-amber-400 px-4 py-2 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">+ Compare another loan</button>
        </div>
        <p className="mt-4 rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">Estimates only. Actual lender calculations may differ because of daily interest, fees, escrow, variable rates, payment timing, or contract-specific rules.</p>
      </header>

      <div className="space-y-6">
        {scenarios.map((scenario) => (
          <LoanScenario key={scenario.id} scenario={scenario} canRemove={scenarios.length > 1} onChange={update} onCopy={() => copyScenario(scenario)} onRemove={() => removeScenario(scenario.id)} />
        ))}
      </div>
    </section>
  );
}

function LoanScenario({ scenario, canRemove, onChange, onCopy, onRemove }) {
  const result = useMemo(() => {
    try { return { value: calculateScenario(scenario), error: "" }; }
    catch (error) { return { value: null, error: error.message }; }
  }, [scenario]);
  const set = (field) => (event) => onChange(scenario.id, field, event.target.value);

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input aria-label="Scenario name" value={scenario.name} onChange={set("name")} className="min-w-0 flex-1 border-0 bg-transparent text-xl font-black text-slate-950 outline-none dark:text-white" />
        <div className="flex gap-2"><button type="button" onClick={onCopy} className="rounded-lg border px-3 py-1.5 text-sm font-bold dark:border-slate-600">Copy</button>{canRemove ? <button type="button" onClick={onRemove} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-bold text-red-700 dark:border-red-800 dark:text-red-300">Remove</button> : null}</div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Loan type"><select aria-label="Loan type" value={scenario.type} onChange={set("type")} className={inputClass}>{LOAN_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
        <Field label="Principal ($)"><input aria-label="Principal" type="number" min="0.01" step="100" value={scenario.principal} onChange={set("principal")} className={inputClass} /></Field>
        <Field label="Annual interest rate (%)"><input aria-label="Annual interest rate" type="number" min="0" step="0.01" value={scenario.annualRate} onChange={set("annualRate")} className={inputClass} /></Field>
        <Field label="First payment date"><input aria-label="First payment date" type="date" value={scenario.firstPaymentDate} onChange={set("firstPaymentDate")} className={inputClass} /></Field>
        <Field label="Term years"><input aria-label="Term years" type="number" min="0" max="100" value={scenario.termYears} onChange={set("termYears")} className={inputClass} /></Field>
        <Field label="Additional term months"><input aria-label="Additional term months" type="number" min="0" max="11" value={scenario.termMonths} onChange={set("termMonths")} className={inputClass} /></Field>
        <Field label="Extra every month ($)"><input aria-label="Recurring extra payment" type="number" min="0" step="10" value={scenario.recurringExtra} onChange={set("recurringExtra")} className={inputClass} /></Field>
        <Field label="One-time extra ($)"><input aria-label="One-time extra payment" type="number" min="0" step="100" value={scenario.oneTimeExtra} onChange={set("oneTimeExtra")} className={inputClass} /></Field>
        <Field label="Apply one-time extra in month"><input aria-label="One-time extra payment month" type="number" min="1" max="1200" value={scenario.oneTimeExtraMonth} onChange={set("oneTimeExtraMonth")} className={inputClass} /></Field>
      </div>

      {result.error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 font-bold text-red-800 dark:bg-red-950/30 dark:text-red-300">{result.error}</p> : null}
      {result.value ? <LoanResults {...result.value} /> : null}
    </article>
  );
}

function LoanResults({ baseline, accelerated, comparison }) {
  return (
    <div className="mt-6">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Fact label="Required payment" value={dollars(accelerated.requiredPaymentCents)} />
        <Fact label="Estimated payoff" value={accelerated.payoffDate} />
        <Fact label="Payments" value={accelerated.paymentCount} />
        <Fact label="Total interest" value={dollars(accelerated.totalInterestCents)} />
        <Fact label="Interest saved" value={dollars(comparison.interestSavedCents)} accent />
        <Fact label="Time saved" value={`${comparison.monthsSaved} months`} accent />
      </dl>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-label="Accelerated payoff compared with original term"><div className="h-full bg-teal-600" style={{ width: `${Math.max(2, (accelerated.paymentCount / baseline.paymentCount) * 100)}%` }} /></div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Teal length represents {accelerated.paymentCount} payments compared with the original {baseline.paymentCount}.</p>

      <details className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-700">
        <summary className="cursor-pointer px-4 py-3 font-black">View full amortization table ({accelerated.rows.length} payments)</summary>
        <div className="max-h-[34rem] overflow-auto border-t dark:border-slate-700">
          <table className="w-full min-w-[58rem] text-right text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="p-3 text-left"># / Date</th><th className="p-3">Starting balance</th><th className="p-3">Payment</th><th className="p-3">Principal</th><th className="p-3">Interest</th><th className="p-3">Extra principal</th><th className="p-3">Ending balance</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{accelerated.rows.map((row) => <tr key={row.month}><td className="p-3 text-left font-bold">{row.month} · {row.paymentDate}</td><td className="p-3">{dollars(row.beginningBalanceCents)}</td><td className="p-3">{dollars(row.paymentCents)}</td><td className="p-3">{dollars(row.principalPaidCents)}</td><td className="p-3">{dollars(row.interestCents)}</td><td className="p-3 text-teal-700 dark:text-teal-300">{dollars(row.extraPrincipalCents)}</td><td className="p-3 font-bold">{dollars(row.endingBalanceCents)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const inputClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
function Field({ label, children }) { return <label className="text-sm font-bold">{label}{children}</label>; }
function Fact({ label, value, accent = false }) { return <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</dt><dd className={`mt-1 font-black ${accent ? "text-teal-700 dark:text-teal-300" : ""}`}>{value}</dd></div>; }

