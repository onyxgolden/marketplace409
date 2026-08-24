"use client";
import { useCallback, useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => value?.replaceAll("_", " ") || "—";

export const depositBalance = (deposit, transactions) => transactions.filter((item) => item.deposit_id === deposit.id)
  .reduce((sum, item) => sum + (["received", "adjustment_increase"].includes(item.transaction_type) ? 1 : -1) * Number(item.amount_cents), 0);

export default function RentalDepositsPanel({ initialData = null }) {
  const [data, setData] = useState(initialData || { deposits: [], transactions: [], schedules: [], tenants: [] });
  const [selectedId, setSelectedId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showTransaction, setShowTransaction] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => fetch("/api/rental").then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setData({ deposits: body.deposits || [], transactions: body.depositTransactions || [], schedules: body.schedules || [], tenants: body.tenants || [] });
  }), []);
  useEffect(() => { if (!initialData) load().catch((reason) => setError(reason.message)); }, [initialData, load]);
  const activeId = data.deposits.some((item) => item.id === selectedId) ? selectedId : data.deposits[0]?.id || "";
  const selected = data.deposits.find((item) => item.id === activeId);
  const transactions = data.transactions.filter((item) => item.deposit_id === activeId);

  async function post(payload) {
    setError(""); setMessage("");
    const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    await load();
  }
  async function save(event) {
    event.preventDefault();
    const element = event.currentTarget, form = new FormData(element);
    try {
      await post({ operation: "save-security-deposit", deposit: { leaseId: form.get("leaseId"), tenantId: form.get("tenantId"), requiredAmountCents: Math.round(Number(form.get("amount")) * 100), jurisdictionCode: form.get("jurisdictionCode") } });
      element.reset(); setShowAdd(false); setMessage("Security-deposit obligation saved.");
    } catch (reason) { setError(reason.message); }
  }
  async function transact(event) {
    event.preventDefault();
    const element = event.currentTarget, form = new FormData(element);
    try {
      await post({ operation: "record-security-deposit-transaction", transaction: { depositId: activeId, transactionType: form.get("transactionType"), amountCents: Math.round(Number(form.get("amount")) * 100), occurredAt: new Date(`${form.get("date")}T12:00:00`).toISOString(), description: form.get("description") } });
      element.reset(); setShowTransaction(false); setMessage("Deposit transaction recorded.");
    } catch (reason) { setError(reason.message); }
  }

  return <section className="space-y-6" data-rental-deposits>
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Liability accounting</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Security deposits</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">Deposits remain tenant liabilities and are never treated as rent or NOI.</p>
        </div>
        <button type="button" onClick={() => setShowAdd((value) => !value)} className={`rounded-xl px-4 py-2 text-sm font-black transition ${goldControlClassName}`}>{showAdd ? "Cancel setup" : "Add deposit requirement"}</button>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</p> : null}
      {showAdd ? <form aria-label="Add deposit requirement" onSubmit={save} className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40 md:grid-cols-4">
        <select name="leaseId" required className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Lease</option>{data.schedules.map((item) => <option key={item.id} value={item.lease_id}>{item.lease_id}</option>)}</select>
        <select name="tenantId" required className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Tenant</option>{data.tenants.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
        <input name="amount" type="number" min="0" step="0.01" required placeholder="Required amount" className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
        <input name="jurisdictionCode" placeholder="Jurisdiction (example TX)" className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
        <button className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 md:col-span-4">Save deposit requirement</button>
      </form> : null}
      <div className="mt-6">
        <RentalRecordBrowser title="Deposit obligations" records={data.deposits} selectedId={activeId} onSelect={(id) => { setSelectedId(id); setShowTransaction(false); }} getTitle={(item) => money.format(Number(item.required_amount_cents) / 100)} getSubtitle={(item) => `${label(item.status)} · ${item.jurisdiction_code || "jurisdiction not recorded"}`} emptyMessage="No deposit obligation recorded.">
          {!selected ? <p className="text-sm text-slate-500 dark:text-slate-400">Add the lease deposit requirement before recording money received.</p> : <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Selected deposit</p>
            <div className="mt-2 flex flex-wrap justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-950 dark:text-white">{money.format(Number(selected.required_amount_cents) / 100)} required</h3>
                <p className="mt-1 text-sm capitalize text-slate-700 dark:text-slate-300">{label(selected.status)} · {selected.jurisdiction_code || "Jurisdiction not recorded"}</p>
              </div>
              <div>
                <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">Held balance</p>
                <p className="text-2xl font-black tabular-nums text-slate-950 dark:text-white">{money.format(depositBalance(selected, data.transactions) / 100)}</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowTransaction((value) => !value)} className={`mt-5 rounded-xl px-4 py-2 text-sm font-black transition ${goldControlClassName}`}>{showTransaction ? "Cancel transaction" : "Record deposit transaction"}</button>
            {showTransaction ? <form aria-label="Record deposit transaction" onSubmit={transact} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 md:grid-cols-2">
              <select name="transactionType" required className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                <option value="received">Deposit received</option>
                <option value="deduction">Documented deduction</option>
                <option value="refunded">Refund to tenant</option>
                <option value="adjustment_increase">Increase adjustment</option>
                <option value="adjustment_decrease">Decrease adjustment</option>
              </select>
              <input name="amount" type="number" min="0.01" step="0.01" required placeholder="Amount" className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
              <input name="date" type="date" required className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
              <input name="description" required placeholder="Reason and evidence reference" className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
              <button className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 md:col-span-2">Record transaction</button>
            </form> : null}
            <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="font-black text-slate-950 dark:text-white">Transaction history</h4>
              {transactions.length ? transactions.map((item) => <p key={item.id} className="mt-2 text-sm capitalize text-slate-700 dark:text-slate-300"><strong className="text-slate-950 dark:text-white">{label(item.transaction_type)}</strong> · {money.format(Number(item.amount_cents) / 100)} · {item.occurred_at ? new Date(item.occurred_at).toLocaleDateString() : "—"}</p>) : <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No deposit transactions recorded.</p>}
            </div>
          </div>}
        </RentalRecordBrowser>
      </div>
      <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">FORGE records dates and evidence but does not determine allowable deductions or legal deadlines.</p>
    </div>
  </section>;
}
