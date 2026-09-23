"use client";
import { useCallback, useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => String(value ?? "—").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
const amountClass = (cents) => cents < 0
  ? "text-emerald-700 dark:text-emerald-400"
  : "text-slate-950 dark:text-white";

export const TENANT_LEDGER_OPEN_EVENT = "forge:open-tenant-ledger";

async function fetchTenantLedger(tenantId) {
  const response = await fetch(`/api/rental/tenant-ledger?tenantId=${encodeURIComponent(tenantId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load payment history.");
  return body;
}

// Tenant card payment history: a "last 3 payments" summary card that expands inline into
// the full chronological ledger — no separate screen, no re-selecting the tenant.
// Deposits render in their own clearly-labeled section, never as rent.
export default function TenantPaymentHistory({ tenantId, tenantName }) {
  const [ledger, setLedger] = useState(null);
  const [deposits, setDeposits] = useState(null);
  const [importedHistory, setImportedHistory] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(tenantId));
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError("");
    try {
      const body = await fetchTenantLedger(tenantId);
      setLedger(body.ledger);
      setDeposits(body.deposits);
      setImportedHistory(body.importedHistory || null);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Mount fetch: promise-chain style (no synchronous setState in the effect body),
  // matching the panel components' established pattern.
  useEffect(() => {
    if (!tenantId) return undefined;
    let cancelled = false;
    fetchTenantLedger(tenantId)
      .then((body) => { if (!cancelled) { setLedger(body.ledger); setDeposits(body.deposits); setImportedHistory(body.importedHistory || null); setError(""); } })
      .catch((caught) => { if (!cancelled) setError(caught.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Right-click shortcut: a tenant card context menu dispatches this to open the full
  // ledger for exactly this tenant without any re-selection step.
  useEffect(() => {
    const open = (event) => {
      if (event.detail?.tenantId === tenantId) {
        if (!ledger && !loading && !error) load();
        setExpanded(true);
        requestAnimationFrame(() => {
          document.getElementById(`tenant-ledger-${tenantId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    };
    window.addEventListener(TENANT_LEDGER_OPEN_EVENT, open);
    return () => window.removeEventListener(TENANT_LEDGER_OPEN_EVENT, open);
  }, [tenantId, ledger, loading, error, load]);

  return (
    <section id={`tenant-ledger-${tenantId}`} data-tenant-payment-history aria-label={`Payment history for ${tenantName || "tenant"}`}
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Payment history</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Last 3 payments</h3>
        </div>
        <button type="button" onClick={() => setExpanded((value) => !value)}
          className={`rounded-xl px-4 py-2 text-sm font-black transition ${goldControlClassName}`}
          aria-expanded={expanded}>
          {expanded ? "Hide full ledger" : "View full payment history"}
        </button>
      </div>

      {loading && <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">Loading payment history…</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {!loading && !error && ledger && (
        <>
          {ledger.last3.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No payments recorded for this tenant yet.</p>
            : <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {ledger.last3.map((entry) => (
                <li key={entry.id} data-last-payment className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
                  <p className={`text-lg font-black ${amountClass(entry.balanceEffectCents)}`}>{money.format(entry.amountCents / 100)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">{formatDate(entry.date)} · {label(entry.method)}</p>
                  <p className="mt-1 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label(entry.status)}</p>
                  {entry.refundedAmountCents > 0 && <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-400">Refunded {money.format(entry.refundedAmountCents / 100)}</p>}
                </li>
              ))}
            </ul>}

          {expanded && (
            <div className="mt-6" data-tenant-full-ledger>
              <h4 className="text-lg font-black text-slate-950 dark:text-white">Full payment ledger</h4>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Chronological, with running balance after every entry. Balance {money.format(ledger.balanceCents / 100)} owed.
              </p>
              {ledger.entries.length === 0
                ? <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No charges or payments on record.</p>
                : <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-2 pr-3 font-black">Date</th>
                        <th className="py-2 pr-3 font-black">Entry</th>
                        <th className="py-2 pr-3 font-black">Period</th>
                        <th className="py-2 pr-3 font-black">Property / unit</th>
                        <th className="py-2 pr-3 font-black">Method</th>
                        <th className="py-2 pr-3 font-black">Status</th>
                        <th className="py-2 pr-3 font-black">Reference</th>
                        <th className="py-2 pr-3 text-right font-black">Amount</th>
                        <th className="py-2 text-right font-black">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.entries.map((entry) => (
                        <tr key={entry.id} data-ledger-entry={entry.kind} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2 pr-3 font-bold text-slate-700 dark:text-slate-300">{formatDate(entry.date)}</td>
                          <td className="py-2 pr-3">
                            <span className="font-bold text-slate-950 dark:text-white">{entry.label}</span>
                            {entry.rentecEvidence?.length > 0 && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-200">Rentec history</span>}
                            {entry.settlement && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Settled</span>}
                          </td>
                          <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{entry.period || "—"}</td>
                          <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{entry.unitLabel} · {entry.propertyLabel}</td>
                          <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{label(entry.method)}</td>
                          <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{label(entry.status)}</td>
                          <td className="py-2 pr-3 text-xs text-slate-500 dark:text-slate-400">{entry.reference || "—"}</td>
                          <td className={`py-2 pr-3 text-right font-black ${amountClass(entry.balanceEffectCents)}`}>{money.format(entry.amountCents / 100)}</td>
                          <td className="py-2 text-right font-black text-slate-950 dark:text-white">{money.format(entry.balanceAfterCents / 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}

              {ledger.unassigned?.length > 0 && (
                <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                  <h5 className="font-black text-amber-900 dark:text-amber-200">Needs review — not assigned to a tenant</h5>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">These applied Rentec imports have no linked charge or payment. They are shown here for reconciliation, never guessed onto a tenant.</p>
                  <ul className="mt-2 space-y-1 text-sm font-bold text-amber-900 dark:text-amber-200">
                    {ledger.unassigned.map((item) => (
                      <li key={item.id}>{formatDate(item.transactionDate)} · {money.format(item.amountCents / 100)} · {item.category || "Rentec import"} · {item.rentecTransactionId}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40" data-tenant-deposits>
                <h4 className="text-lg font-black text-slate-950 dark:text-white">Deposits</h4>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Security deposits are held funds — never rent. Currently held: {money.format((deposits?.heldCents || 0) / 100)}.</p>
                {(deposits?.entries?.length || 0) === 0
                  ? <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No deposit activity recorded.</p>
                  : <ul className="mt-3 space-y-2 text-sm">
                    {deposits.entries.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                        <span className="font-bold text-slate-950 dark:text-white">{entry.label} · {formatDate(entry.date)}</span>
                        <span className="font-black text-slate-950 dark:text-white">{money.format(entry.amountCents / 100)} <span className="font-bold text-slate-500">· held {money.format(entry.balanceAfterCents / 100)}</span></span>
                      </li>
                    ))}
                  </ul>}
                <a href="/forge/rental?section=deposits" className="mt-3 inline-block text-sm font-bold text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">Open the Deposits section</a>
              </div>

              {(importedHistory?.rows?.length || 0) > 0 && (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40" data-imported-rentec-transactions>
                  <h4 className="text-lg font-black text-slate-950 dark:text-white">Imported Rentec Transactions</h4>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Rentec-imported records linked to this tenant — accounting history only. They do not affect the balance above.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          <th className="py-2 pr-3 font-black">Date</th>
                          <th className="py-2 pr-3 font-black">Description</th>
                          <th className="py-2 pr-3 font-black">Category</th>
                          <th className="py-2 text-right font-black">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importedHistory.rows.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                            <td className="py-2 pr-3 font-bold text-slate-700 dark:text-slate-300">{formatDate(row.eventDate)}</td>
                            <td className="py-2 pr-3 font-bold text-slate-950 dark:text-white">{row.description || "—"}</td>
                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{label(row.category) || "—"}</td>
                            <td className="py-2 text-right font-black text-slate-950 dark:text-white">{money.format(row.amountCents / 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                    {importedHistory.rows.length} transaction{importedHistory.rows.length === 1 ? "" : "s"} · total {money.format(importedHistory.totalCents / 100)} · source: Rentec import
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
