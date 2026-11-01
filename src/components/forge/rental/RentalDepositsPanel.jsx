"use client";
import { useCallback, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { seedCacheEntry } from "@/hooks/swrCache";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => value?.replaceAll("_", " ") || "—";

export const depositBalance = (deposit, transactions) => transactions.filter((item) => item.deposit_id === deposit.id && !item.voided_at)
  .reduce((sum, item) => sum + (["received", "adjustment_increase"].includes(item.transaction_type) ? 1 : -1) * Number(item.amount_cents), 0);

// A deposit's human identity, resolved from the payload's own joins: the
// tenant name straight off the deposit, the property via lease -> unit.
// When nothing resolves, the raw lease id is the label — never a blank.
export function depositIdentity(deposit, { tenants = [], leases = [], units = [] } = {}) {
  const tenantName = tenants.find((item) => item.id === deposit?.tenant_id)?.display_name || null;
  const lease = leases.find((item) => item.id === deposit?.lease_id) || null;
  const unitLabel = units.find((item) => item.id === lease?.unit_id)?.label || null;
  const parts = [tenantName, unitLabel].filter(Boolean);
  return { tenantName, unitLabel, label: parts.length ? parts.join(" — ") : (deposit?.lease_id || "—") };
}

// Lease-picker label: property via lease -> unit, tenant via the lease's
// primary membership (first member as fallback). Same never-blank rule.
export function leasePickerLabel(leaseId, { leases = [], units = [], tenants = [], leaseMemberships = [] } = {}) {
  const lease = leases.find((item) => item.id === leaseId) || null;
  const unitLabel = units.find((item) => item.id === lease?.unit_id)?.label || null;
  const members = leaseMemberships.filter((item) => item.lease_id === leaseId);
  const primary = members.find((item) => item.occupancy_role === "primary") || members[0];
  const tenantName = tenants.find((item) => item.id === primary?.tenant_id)?.display_name || null;
  const parts = [unitLabel, tenantName].filter(Boolean);
  return parts.length ? parts.join(" — ") : leaseId;
}

export default function RentalDepositsPanel({ initialData = null }) {
  // Security deposits: stale-while-revalidate. The cached obligations render
  // instantly on return visits and refresh in the background — the last good
  // list never blanks out. Mutations post through /api/rental then call
  // refresh() to revalidate. Parent-supplied initialData is seeded into the
  // cache so the key stays live: first paint is instant, no mount refetch
  // fires (the entry is fresh), and refresh() after mutations actually
  // revalidates.
  if (initialData) seedCacheEntry("rental:deposits", initialData);
  const fetchDeposits = useCallback(async () => {
    const response = await fetch("/api/rental");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return { deposits: body.deposits || [], transactions: body.depositTransactions || [], schedules: body.schedules || [], tenants: body.tenants || [], units: body.units || [], leases: body.leases || [], leaseMemberships: body.leaseMemberships || [] };
  }, []);
  const { data: loaded, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:deposits",
    fetchDeposits,
    { ttlMs: 60_000 },
  );
  const data = loaded;
  const [selectedId, setSelectedId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showTransaction, setShowTransaction] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [voidTxId, setVoidTxId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function post(payload) {
    setError(""); setMessage("");
    const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    await refresh();
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
  // Controls-sweep G6: requirement and transaction corrections. Nothing is
  // rewritten or deleted: requirements void (keeping history), transactions
  // void with a reason (staying in the history, excluded from balances), and
  // a correction is void + re-record.
  async function updateRequirement(event) {
    event.preventDefault();
    const element = event.currentTarget, form = new FormData(element);
    try {
      await post({ operation: "update-security-deposit", deposit: { depositId: activeId, requiredAmountCents: Math.round(Number(form.get("amount")) * 100), jurisdictionCode: form.get("jurisdictionCode") } });
      setShowEdit(false); setMessage(`Deposit requirement updated: ${money.format(Math.round(Number(form.get("amount")) * 100) / 100)} required — ${form.get("jurisdictionCode") || "jurisdiction not recorded"}.`);
    } catch (reason) { setError(reason.message); }
  }
  async function voidRequirement() {
    if (!window.confirm("Void this deposit requirement? It stays listed with its transaction history, but can no longer be edited.")) return;
    try {
      await post({ operation: "void-security-deposit", depositId: activeId });
      setMessage("Deposit requirement voided. Its transaction history is preserved below.");
    } catch (reason) { setError(reason.message); }
  }
  async function voidTransaction(event, transactionId) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await post({ operation: "void-security-deposit-transaction", transactionId, reason: form.get("reason") });
      setVoidTxId(null); setMessage("Deposit transaction voided. The held balance was recomputed without it.");
    } catch (reason) { setError(reason.message); }
  }

  if (!data && isLoading) return <ForgeLoadingState label="Loading security deposits…" />;
  if (!data && loadError) {
    return <ForgeErrorState
      title="Unable to load security deposits"
      detail={loadError}
      onRetry={() => refresh()}
    />;
  }

  const activeId = data.deposits.some((item) => item.id === selectedId) ? selectedId : data.deposits[0]?.id || "";
  const selected = data.deposits.find((item) => item.id === activeId);
  const transactions = data.transactions.filter((item) => item.deposit_id === activeId);
  // One picker option per lease: schedules repeat a lease id, and identical
  // values would render as duplicate labels.
  const leaseOptions = [];
  { const seen = new Set(); for (const item of data.schedules) { if (!item.lease_id || seen.has(item.lease_id)) continue; seen.add(item.lease_id); leaseOptions.push(item.lease_id); } }

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
      {data && loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved deposits.</p> : null}
      {data && isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
      {showAdd ? <form aria-label="Add deposit requirement" onSubmit={save} className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40 md:grid-cols-4">
        <select name="leaseId" required className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Lease</option>{leaseOptions.map((leaseId) => <option key={leaseId} value={leaseId}>{leasePickerLabel(leaseId, data)}</option>)}</select>
        <select name="tenantId" required className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Tenant</option>{data.tenants.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
        <input name="amount" type="number" min="0" step="0.01" required placeholder="Required amount" className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
        <input name="jurisdictionCode" placeholder="Jurisdiction (example TX)" className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
        <button className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 md:col-span-4">Save deposit requirement</button>
      </form> : null}
      <div className="mt-6">
        <RentalRecordBrowser title="Deposit obligations" records={data.deposits} selectedId={activeId} onSelect={(id) => { setSelectedId(id); setShowTransaction(false); setShowEdit(false); setVoidTxId(null); }} getTitle={(item) => money.format(Number(item.required_amount_cents) / 100)} getSubtitle={(item) => `${depositIdentity(item, data).label} · ${label(item.status)} · ${item.jurisdiction_code || "jurisdiction not recorded"}`} emptyMessage="No deposit obligation recorded.">
          {!selected ? <p className="text-sm text-slate-500 dark:text-slate-400">Add the lease deposit requirement before recording money received.</p> : <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Selected deposit</p>
            <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">{depositIdentity(selected, data).label}</p>
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
            {selected.status === "void" ? <p className="mt-5 text-sm text-slate-600 dark:text-slate-400">This requirement is void — it cannot be edited. Its transaction history is preserved below.</p> : <div className="mt-5 flex flex-wrap gap-2">
              {selected.status !== "closed" && <button type="button" onClick={() => setShowEdit((value) => !value)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{showEdit ? "Cancel edit" : "Edit requirement"}</button>}
              <button type="button" onClick={voidRequirement} className="rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">Void requirement</button>
            </div>}
            {showEdit && selected.status !== "void" && selected.status !== "closed" && <form aria-label="Edit deposit requirement" onSubmit={updateRequirement} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 md:grid-cols-2">
              <label className="text-sm font-bold text-slate-900 dark:text-white">Required amount<input name="amount" type="number" min="0" step="0.01" required defaultValue={(Number(selected.required_amount_cents) / 100).toFixed(2)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
              <label className="text-sm font-bold text-slate-900 dark:text-white">Jurisdiction<input name="jurisdictionCode" defaultValue={selected.jurisdiction_code || ""} placeholder="Jurisdiction (example TX)" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
              <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 md:col-span-2">Save requirement changes</button>
            </form>}
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
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">To correct a transaction, void it and record the corrected one — voided entries stay in the history and stop counting toward the held balance.</p>
              {transactions.length ? transactions.map((item) => <div key={item.id} className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className={`text-sm capitalize text-slate-700 dark:text-slate-300 ${item.voided_at ? "line-through" : ""}`}><strong className="text-slate-950 dark:text-white">{label(item.transaction_type)}</strong> · {money.format(Number(item.amount_cents) / 100)} · {item.occurred_at ? new Date(item.occurred_at).toLocaleDateString() : "—"}{item.voided_at ? ` · Voided: ${item.void_reason || "no reason recorded"}` : ""}</p>
                {!item.voided_at && selected.status !== "void" && (voidTxId === item.id
                  ? <form aria-label={`Void transaction ${item.id}`} onSubmit={(event) => voidTransaction(event, item.id)} className="flex flex-wrap items-center gap-2">
                    <input name="reason" required placeholder="Reason for voiding" className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                    <button className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">Confirm void</button>
                    <button type="button" onClick={() => setVoidTxId(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
                  </form>
                  : <button type="button" onClick={() => setVoidTxId(item.id)} className="rounded-lg border border-red-300 px-3 py-1 text-xs font-bold text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">Void transaction</button>)}
              </div>) : <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No deposit transactions recorded.</p>}
            </div>
          </div>}
        </RentalRecordBrowser>
      </div>
      <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">FORGE records dates and evidence but does not determine allowable deductions or legal deadlines.</p>
    </div>
  </section>;
}
