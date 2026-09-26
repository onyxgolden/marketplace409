"use client";
import { useMemo, useState } from "react";
import { resolveChargeIdentity } from "./RentalPaymentsPanel";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => value?.replaceAll("_", " ") || "—";

export const todayISO = (today = new Date()) => today.toISOString().slice(0, 10);

// Calendar-day overdue count for a due date against a YYYY-MM-DD "today".
// Zero when the charge is not yet overdue (due today or in the future).
export function daysOverdue(dueDate, today) {
  if (!dueDate || !today) return 0;
  const elapsed = Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`);
  if (Number.isNaN(elapsed)) return 0;
  return Math.max(0, Math.round(elapsed / 86400000));
}

// Pure builder: every charge with a remaining balance becomes one checklist row,
// enriched with the same tenant/unit/property identity the payments panel uses.
// Sorted oldest due date first so the most overdue rent collects first.
export function buildBatchRentRows(charges, data, today) {
  return (charges || [])
    .map((charge) => {
      const balanceCents = Number(charge.amount_cents) - Number(charge.paid_amount_cents || 0);
      const identity = resolveChargeIdentity(charge, data || {});
      return Object.freeze({
        chargeId: charge.id,
        period: charge.period || "—",
        chargeType: charge.charge_type || "rent",
        dueDate: charge.due_date || "—",
        balanceCents,
        daysOverdue: daysOverdue(charge.due_date, today),
        tenantLabel: identity.tenantLabel,
        unitLabel: identity.unitLabel,
        propertyLabel: identity.propertyLabel,
      });
    })
    .filter((row) => Number.isSafeInteger(row.balanceCents) && row.balanceCents > 0)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

const overdueText = (row) =>
  row.daysOverdue > 0 ? `${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"} overdue` : "Due today or upcoming";

export default function RentalBatchRentChecklist({ data, onRefresh = async () => { }, today = null }) {
  const asOf = today || todayISO();
  const rows = useMemo(() => buildBatchRentRows(data?.openCharges, data, asOf), [data, asOf]);
  const [checked, setChecked] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [receivedDate, setReceivedDate] = useState(asOf);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);

  const selectedRows = rows.filter((row) => checked[row.chargeId]);
  const selectedTotalCents = selectedRows.reduce((sum, row) => sum + row.balanceCents, 0);
  const allChecked = rows.length > 0 && rows.every((row) => checked[row.chargeId]);

  function toggleRow(chargeId) {
    setChecked((previous) => ({ ...previous, [chargeId]: !previous[chargeId] }));
  }
  function toggleAll() {
    setChecked(allChecked ? {} : Object.fromEntries(rows.map((row) => [row.chargeId, true])));
  }

  // One record-offline-payment POST per checked row — the same operation and payload
  // shape the single-payment flow uses, with a deterministic idempotency key per
  // row derived from the payment intent itself (charge + received date + method +
  // amount). The key is stable across retries, refreshes, and remounts, so a
  // retried batch replays instead of double-recording. Rows that fail keep their
  // error and never block the rest; the summary reports exactly what landed.
  async function recordBatch() {
    if (selectedRows.length === 0) return;
    setBusy(true); setError(""); setSummary(null);
    const recorded = [], failed = [];
    for (const row of selectedRows) {
      const payload = {
        operation: "record-offline-payment",
        payment: {
          chargeId: row.chargeId,
          paymentMethod,
          amountCents: row.balanceCents,
          receivedAt: new Date(`${receivedDate}T12:00:00`).toISOString(),
          receiptReference: "",
          notes: "Batch rent collection",
          // Deterministic per payment intent: the same charge recorded with the
          // same received date, method, and amount always produces the same
          // key, so a retry after a refresh or remount replays instead of
          // double-recording. A genuinely different payment (different date,
          // method, or amount) gets a different key.
          idempotencyKey: `batch-rent-payment-${row.chargeId}-${receivedDate}-${paymentMethod}-${row.balanceCents}`,
        },
      };
      try {
        const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to record payment.");
        recorded.push(row);
      } catch (failure) {
        failed.push({ row, error: failure?.message || "Unable to record payment." });
      }
    }
    setBusy(false);
    setSummary({
      recorded,
      failed,
      totalCents: recorded.reduce((sum, row) => sum + row.balanceCents, 0),
    });
    setChecked({});
    if (recorded.length > 0) {
      try { await onRefresh(); } catch (refreshError) { setError(String(refreshError?.message || refreshError)); }
    }
  }

  return <section data-batch-rent-checklist className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Batch collection</p>
        <h3 className="mt-1 text-xl font-black tracking-tight text-slate-950 dark:text-white">Outstanding balances as of {asOf}</h3>
        <p className="mt-1 max-w-xl text-sm text-slate-600 dark:text-slate-400">
          Check the rents received, then record them all in one pass. Each checked row posts
          the same offline payment the single-payment form records.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold text-slate-900 dark:text-white">Payment method
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="mt-1 block rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white">
            <option value="cash">Cash</option>
            <option value="cashiers_check">Cashier&apos;s check</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Date received
          <input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="mt-1 block rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
        </label>
      </div>
    </div>

    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}

    {rows.length === 0 ? (
      <p className="mt-4 rounded-xl bg-white p-4 text-sm font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">No outstanding rent as of {asOf} — every charge is settled.</p>
    ) : (
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="p-3"><input type="checkbox" aria-label="Select all outstanding rents" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-amber-600" /></th>
              <th className="p-3 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Tenant / property</th>
              <th className="p-3 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Amount owed</th>
              <th className="p-3 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Due date</th>
              <th className="p-3 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Days overdue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.chargeId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="p-3"><input type="checkbox" aria-label={`Record rent for ${row.tenantLabel}, ${row.period}`} checked={!!checked[row.chargeId]} onChange={() => toggleRow(row.chargeId)} className="h-4 w-4 accent-amber-600" /></td>
                <td className="p-3 font-bold text-slate-900 dark:text-white">{row.tenantLabel}<span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{row.unitLabel} · {row.propertyLabel} · {row.period} · {label(row.chargeType)}</span></td>
                <td className="p-3 font-black text-slate-950 dark:text-white">{money.format(row.balanceCents / 100)}</td>
                <td className="p-3 font-bold text-slate-700 dark:text-slate-300">{row.dueDate}</td>
                <td className="p-3"><span className={`inline-block rounded-full px-2.5 py-1 text-xs font-black ${row.daysOverdue > 0 ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"}`}>{overdueText(row)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={recordBatch} disabled={busy || selectedRows.length === 0} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
        {busy ? "Recording…" : selectedRows.length ? `Record received — ${selectedRows.length} payment${selectedRows.length === 1 ? "" : "s"} · ${money.format(selectedTotalCents / 100)}` : "Record received"}
      </button>
      {selectedRows.length > 0 ? <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Recording each checked row as a {paymentMethod === "cash" ? "cash" : "cashier's check"} payment dated {receivedDate}.</p> : null}
    </div>

    {summary ? (
      <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <p className="text-sm font-black text-emerald-900 dark:text-emerald-200">
          Recorded {summary.recorded.length} payment{summary.recorded.length === 1 ? "" : "s"} totaling {money.format(summary.totalCents / 100)}.
        </p>
        {summary.recorded.length ? <ul className="mt-2 space-y-1 text-sm font-bold text-emerald-800 dark:text-emerald-300">
          {summary.recorded.map((row) => <li key={row.chargeId}>{row.tenantLabel} — {money.format(row.balanceCents / 100)} for {row.period} rent (due {row.dueDate})</li>)}
        </ul> : null}
        {summary.failed.length ? <div className="mt-3 rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
          <p className="text-sm font-black text-red-800 dark:text-red-300">{summary.failed.length} payment{summary.failed.length === 1 ? " was" : "s were"} not recorded — those rows are still outstanding.</p>
          <ul className="mt-1 space-y-1 text-sm font-bold text-red-700 dark:text-red-400">
            {summary.failed.map(({ row, error: rowError }) => <li key={row.chargeId}>{row.tenantLabel} — {rowError}</li>)}
          </ul>
        </div> : null}
      </div>
    ) : null}
  </section>;
}
