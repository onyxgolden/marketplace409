"use client";
import { useCallback, useMemo } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function buildRentalReconciliation(payments, settlements) {
  const byPayment = new Map(settlements.map((value) => [value.payment_id, value]));
  return payments.map((payment) => {
    const settlement = byPayment.get(payment.id) || null;
    let state = "not_applicable";
    if (payment.provider === "stripe" && payment.status === "succeeded") state = settlement ? settlement.status : "awaiting_settlement";
    else if (payment.provider === "stripe" && ["failed", "disputed"].includes(payment.status)) state = "attention";
    return { payment, settlement, reconciliationState: state };
  });
}

const STATE_TONE = {
  attention: "text-red-700 dark:text-red-400",
  awaiting_settlement: "text-amber-700 dark:text-amber-400",
};

export default function RentalReconciliationPanel() {
  // Payment reconciliation: stale-while-revalidate. The cached reconciliation
  // table renders instantly on return visits and refreshes in the background —
  // the last good data never blanks out. Reconciliation stays human-gated:
  // the panel is read-only; any future confirm flow must keep the checkbox +
  // "CONFIRM" gate and soft/reversible writes.
  const fetchReconciliation = useCallback(async () => {
    const response = await fetch("/api/rental");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return { payments: body.payments || [], settlements: body.settlements || [] };
  }, []);
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:reconciliation",
    fetchReconciliation,
    { ttlMs: 60_000 },
  );
  const rows = useMemo(() => buildRentalReconciliation(data?.payments || [], data?.settlements || []), [data]);

  if (!data && isLoading) return <ForgeLoadingState label="Loading reconciliation…" />;
  if (!data && loadError) return <ForgeErrorState title="Unable to load reconciliation" detail={loadError} onRetry={() => refresh()} />;

  return <section className="space-y-6" data-rental-reconciliation>
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Accounting control</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Payment reconciliation</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
        Successful rent payments post once to FORGE rental income. Refunds and disputes reopen the charge balance and post a separate negative adjustment without deleting the original receipt.
      </p>
      {loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved reconciliation.</p> : null}
      {isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/40">
              <th className="p-3 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment</th>
              <th className="p-3 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount</th>
              <th className="p-3 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment status</th>
              <th className="p-3 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Reconciliation</th>
              <th className="p-3 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Net deposit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ payment, settlement, reconciliationState }) => (
              <tr key={payment.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                <td className="p-3 font-mono text-xs text-slate-600 dark:text-slate-400">{payment.id}</td>
                <td className="p-3 font-bold tabular-nums text-slate-950 dark:text-white">{money.format(payment.amount_cents / 100)}</td>
                <td className="p-3 capitalize text-slate-700 dark:text-slate-300">{payment.status.replaceAll("_", " ")}</td>
                <td className={`p-3 font-bold capitalize ${STATE_TONE[reconciliationState] || "text-slate-700 dark:text-slate-300"}`}>{reconciliationState.replaceAll("_", " ")}</td>
                <td className="p-3 tabular-nums text-slate-700 dark:text-slate-300">{settlement ? money.format(settlement.net_amount_cents / 100) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan="5" className="p-4 text-slate-500 dark:text-slate-400">No rental payments recorded.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <strong>Current boundary:</strong> gross rental income posting is implemented. Stripe fees, balance transactions, and bank payout matching must be ingested before a payment is marked fully reconciled.
      </p>
    </div>
  </section>;
}
