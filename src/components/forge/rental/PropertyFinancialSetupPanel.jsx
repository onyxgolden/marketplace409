"use client";
import { useEffect, useState } from "react";

function emptyLine() {
  return { date: "", description: "", amount: "", capitalized: true };
}

export function setupToFormState(setup) {
  if (!setup) {
    return {
      financialAccountId: "", purchaseDate: "", purchasePrice: "", downPayment: "", closingCosts: "",
      initialValuation: "", initialValuationDate: "", lenderName: "", loanOriginalPrincipal: "",
      loanOriginationDate: "", loanCurrentBalance: "", loanCurrentBalanceAsOf: "", loanInterestRatePercent: "",
    };
  }
  const dollars = (cents) => (cents === null || cents === undefined ? "" : String(Number(cents) / 100));
  return {
    financialAccountId: setup.financial_account_id || "",
    purchaseDate: setup.purchase_date || "", purchasePrice: dollars(setup.purchase_price_cents),
    downPayment: dollars(setup.down_payment_cents), closingCosts: dollars(setup.closing_costs_cents),
    initialValuation: dollars(setup.initial_valuation_cents), initialValuationDate: setup.initial_valuation_date || "",
    lenderName: setup.lender_name || "", loanOriginalPrincipal: dollars(setup.loan_original_principal_cents),
    loanOriginationDate: setup.loan_origination_date || "", loanCurrentBalance: dollars(setup.loan_current_balance_cents),
    loanCurrentBalanceAsOf: setup.loan_current_balance_as_of || "",
    loanInterestRatePercent: setup.loan_interest_rate_bps === null || setup.loan_interest_rate_bps === undefined
      ? "" : String(Number(setup.loan_interest_rate_bps) / 100),
  };
}

export default function PropertyFinancialSetupPanel({ recordContext }) {
  const propertyId = recordContext?.propertyId || "";
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(setupToFormState(null));
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [hadSetup, setHadSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true); setError(""); setResult(null);
    fetch(`/api/rental/property-financial-setup?propertyId=${encodeURIComponent(propertyId)}`)
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to load financial setup.");
        setForm(setupToFormState(payload.setup));
        setHadSetup(Boolean(payload.setup));
        setAccounts(payload.available_accounts || []);
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }
  function updateLine(index, name, value) {
    setTransactions((current) => current.map((line, i) => (i === index ? { ...line, [name]: value } : line)));
  }
  function addLine() {
    setTransactions((current) => [...current, emptyLine()]);
  }
  function removeLine(index) {
    setTransactions((current) => current.filter((_, i) => i !== index));
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/rental/property-financial-setup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId, ...form, transactions }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the property financial setup.");
      setResult(payload.result);
      setHadSetup(true);
      setTransactions([]);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!propertyId) {
    return <p role="alert" className="rounded-xl bg-red-50 p-4 font-bold text-red-800">Select a property before opening financial setup.</p>;
  }
  if (loading) return <p role="status" className="rounded-xl bg-cyan-50 p-4 font-bold text-cyan-900">Loading financial setup…</p>;

  return <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-property-financial-setup-panel>
    <div>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-600">Financial data</p>
      <h2 className="mt-2 text-2xl font-black">Financial setup — {propertyId}</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
        {hadSetup ? "This property already has a financial setup. Saving again updates the acquisition record and replaces its recorded transactions." : "This property has no financial history in Financial FORGE yet. Recording acquisition details here writes the corresponding transactions against this exact property — no new property is created."}
      </p>
    </div>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 font-bold text-red-800">{error}</p> : null}
    {result ? <p role="status" className="rounded-xl bg-emerald-50 p-4 font-bold text-emerald-900">Saved. {result.financial_events_written} financial event(s) recorded.</p> : null}

    <form onSubmit={save} className="space-y-6">
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">Acquisition</legend>
        <label className="text-sm font-bold">Purchase date<input required type="date" value={form.purchaseDate} onChange={(e) => updateField("purchaseDate", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Purchase price<input required type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => updateField("purchasePrice", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Down payment<input required type="number" min="0" step="0.01" value={form.downPayment} onChange={(e) => updateField("downPayment", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Closing costs<input type="number" min="0" step="0.01" value={form.closingCosts} onChange={(e) => updateField("closingCosts", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Initial valuation<input type="number" min="0" step="0.01" value={form.initialValuation} onChange={(e) => updateField("initialValuation", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Initial valuation date<input type="date" value={form.initialValuationDate} onChange={(e) => updateField("initialValuationDate", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold sm:col-span-2 lg:col-span-1">Bank / account used<select required value={form.financialAccountId} onChange={(e) => updateField("financialAccountId", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950"><option value="">Choose FORGE account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">Mortgage / loan</legend>
        <label className="text-sm font-bold">Lender<input type="text" value={form.lenderName} onChange={(e) => updateField("lenderName", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Original principal<input type="number" min="0" step="0.01" value={form.loanOriginalPrincipal} onChange={(e) => updateField("loanOriginalPrincipal", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Origination date<input type="date" value={form.loanOriginationDate} onChange={(e) => updateField("loanOriginationDate", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Current balance<input type="number" min="0" step="0.01" value={form.loanCurrentBalance} onChange={(e) => updateField("loanCurrentBalance", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Balance as of<input type="date" value={form.loanCurrentBalanceAsOf} onChange={(e) => updateField("loanCurrentBalanceAsOf", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
        <label className="text-sm font-bold">Interest rate (%)<input type="number" min="0" max="100" step="0.01" value={form.loanInterestRatePercent} onChange={(e) => updateField("loanInterestRatePercent", e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 dark:bg-slate-950" /></label>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">Acquisition &amp; renovation transactions</legend>
        <div className="space-y-3">
          {transactions.map((line, index) => <div key={index} className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800 sm:grid-cols-[1fr_2fr_1fr_1fr_auto]">
            <input required type="date" aria-label={`Date for transaction ${index + 1}`} value={line.date} onChange={(e) => updateLine(index, "date", e.target.value)} className="rounded-lg border bg-white px-2 py-2 text-sm dark:bg-slate-950" />
            <input required type="text" aria-label={`Description for transaction ${index + 1}`} placeholder="Description" value={line.description} onChange={(e) => updateLine(index, "description", e.target.value)} className="rounded-lg border bg-white px-2 py-2 text-sm dark:bg-slate-950" />
            <input required type="number" min="0" step="0.01" aria-label={`Amount for transaction ${index + 1}`} placeholder="Amount" value={line.amount} onChange={(e) => updateLine(index, "amount", e.target.value)} className="rounded-lg border bg-white px-2 py-2 text-sm dark:bg-slate-950" />
            <select aria-label={`Classification for transaction ${index + 1}`} value={line.capitalized ? "capital" : "operating"} onChange={(e) => updateLine(index, "capitalized", e.target.value === "capital")} className="rounded-lg border bg-white px-2 py-2 text-sm dark:bg-slate-950"><option value="capital">Capital improvement</option><option value="operating">Operating expense</option></select>
            <button type="button" onClick={() => removeLine(index)} className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200">Remove</button>
          </div>)}
        </div>
        <button type="button" onClick={addLine} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white dark:bg-cyan-500 dark:text-slate-950">Add transaction</button>
      </fieldset>

      <button type="submit" disabled={busy} className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-40">{busy ? "Saving…" : "Save financial setup"}</button>
    </form>
  </section>;
}
