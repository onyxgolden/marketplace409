"use client";
import { useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);

// Narrow, authenticated import-control screen for the Rentec financial-history resume importer.
// Deliberately shows only aggregate counts and dollar totals per year — never a raw transaction
// description, Rentec category, or transaction id — and only ever lets one year be approved at a
// time, oldest first, with an explicit confirm step before anything is written.
export default function RentecFinancialHistoryImportPanel() {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState("");
  const [batchPlan, setBatchPlan] = useState(null);
  const [classificationCounts, setClassificationCounts] = useState(null);
  const [importBatchId, setImportBatchId] = useState(null);
  const [confirmingYear, setConfirmingYear] = useState(null);
  const [approvingYear, setApprovingYear] = useState(null);
  // Populated only when confirmApprove() succeeds for that year — this session's own record of what
  // it approved, kept displayed with its result even after a fresh preview no longer lists that year
  // (because it now has nothing left eligible).
  const [approvedYearResults, setApprovedYearResults] = useState({}); // { [year]: { insertedCount, skippedCount, rejectedCount, incomeCents, expenseCents } }

  async function runPreview() {
    setLoadingPreview(true); setError("");
    try {
      const response = await fetch("/api/rental/rentec-financial-history-import-preview", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setBatchPlan(body.batchPlan);
      setClassificationCounts(body.preview.classificationCounts);
      if (!importBatchId) setImportBatchId(`rentec_financial_history_ui_${crypto.randomUUID()}`);
    } catch (caught) { setError(caught.message); }
    finally { setLoadingPreview(false); }
  }

  const pendingByYear = batchPlan?.eligibleByYear || [];
  // Rows to render: every year still pending in the last-loaded preview, plus every year this
  // session already approved (so its result stays visible as "Done" even before the next manual
  // preview refresh) — merged and sorted ascending, oldest first.
  const years = [...new Set([...pendingByYear.map((batch) => batch.year), ...Object.keys(approvedYearResults)])].sort();
  // The oldest year that hasn't been approved yet *this session* — deliberately not re-derived from
  // a fresh preview after every approval. The approval endpoint already re-fetches Rentec and
  // recomputes its own batch fresh immediately before writing, which is the actual correctness
  // guarantee; requiring a second full-account Rentec fetch here too (right on top of the one the
  // approval itself just did) was hitting Rentec's own rate limit and left the page showing stale
  // "Ready" status even after a real, successful approval. Click "Run fresh preview" any time to get
  // an authoritative refresh (e.g. before approving the current, still-active year).
  const nextYear = pendingByYear.find((batch) => !approvedYearResults[batch.year])?.year ?? null;

  function startConfirm(year) { setConfirmingYear(year); setError(""); }
  function cancelConfirm() { setConfirmingYear(null); }

  async function confirmApprove(batch) {
    setApprovingYear(batch.year); setConfirmingYear(null); setError("");
    try {
      const response = await fetch("/api/rental/rentec-financial-history-import-approve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ importBatchId, sourceRecordIds: batch.sourceRecordIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setApprovedYearResults((current) => ({
        ...current,
        [batch.year]: {
          insertedCount: body.insertedCount, skippedCount: body.skippedCount,
          rejectedCount: body.rejected.length, incomeCents: body.incomeCents, expenseCents: body.expenseCents,
        },
      }));
    } catch (caught) { setError(caught.message); }
    finally { setApprovingYear(null); }
  }

  return <section className="space-y-6" data-rentec-financial-history-import>
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Financial History</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Import Rentec financial history</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
        Preview the Rentec transaction history still missing from Rental Manager's financial events and,
        on your explicit approval, import it one year at a time, oldest first. Nothing is written until
        you confirm a specific year, and every batch is recomputed fresh on the server immediately before
        it writes anything.
      </p>
      <p className="mt-3 text-sm font-bold text-amber-800 dark:text-amber-400">Preview only until you approve a specific year below — nothing is written by loading this page or running a preview.</p>

      <div className="mt-5">
        <button type="button" disabled={loadingPreview || approvingYear !== null} onClick={runPreview}
          className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
          {loadingPreview ? "Running preview…" : batchPlan ? "Run fresh preview" : "Run preview"}
        </button>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}

      {classificationCounts ? <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Object.entries(classificationCounts).map(([classification, count]) => (
          <div key={classification} className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
            <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{classification.replace(/([a-z])([A-Z])/g, "$1 $2")}</p>
            <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{count}</p>
          </div>
        ))}
      </div> : null}

      {batchPlan?.heldBackCommissions?.count > 0 ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {batchPlan.heldBackCommissions.count} row{batchPlan.heldBackCommissions.count === 1 ? "" : "s"} ({money(batchPlan.heldBackCommissions.amountCents)}) held back for manual review —
          possible real-estate-purchase duplicates that this importer can&apos;t safely auto-classify. Not included in any batch below.
        </p>
      ) : null}

      {batchPlan?.excludedZeroAmountCount > 0 ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          {batchPlan.excludedZeroAmountCount} row{batchPlan.excludedZeroAmountCount === 1 ? "" : "s"} with a $0.00 amount excluded automatically —
          no financial impact to record. Not included in any batch below.
        </p>
      ) : null}

      {batchPlan ? <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="p-2 text-slate-700 dark:text-slate-300">Year</th><th className="p-2 text-slate-700 dark:text-slate-300">Rows</th><th className="p-2 text-slate-700 dark:text-slate-300">Income</th><th className="p-2 text-slate-700 dark:text-slate-300">Expense</th><th className="p-2 text-slate-700 dark:text-slate-300">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {years.length === 0 ? <tr><td colSpan={6} className="p-3 text-slate-500 dark:text-slate-400">Nothing eligible to import — every available year is already represented, held back for review, or excluded.</td></tr> : null}
            {years.map((year) => {
              const batch = pendingByYear.find((candidate) => candidate.year === year);
              const result = approvedYearResults[year];
              const isDone = Boolean(result);
              const isNext = year === nextYear;
              const isConfirming = confirmingYear === year;
              const isApproving = approvingYear === year;
              return <tr key={year} className="border-b border-slate-100 align-top last:border-b-0 dark:border-slate-800">
                <td className="p-2 font-black text-slate-950 dark:text-white">{year}</td>
                <td className="p-2 text-slate-700 dark:text-slate-300">{isDone ? result.insertedCount : batch?.count ?? 0}</td>
                <td className="p-2 tabular-nums text-slate-700 dark:text-slate-300">{money(isDone ? result.incomeCents : batch?.incomeCents)}</td>
                <td className="p-2 tabular-nums text-slate-700 dark:text-slate-300">{money(isDone ? result.expenseCents : batch?.expenseCents)}</td>
                <td className="p-2">
                  {isDone ? <span className="font-bold text-emerald-700 dark:text-emerald-400">Done — {result.insertedCount} imported</span>
                    : isApproving ? <span className="font-bold text-slate-500 dark:text-slate-400">Approving…</span>
                    : isNext ? <span className="font-bold text-sky-700 dark:text-sky-400">Ready</span>
                    : <span className="text-slate-400 dark:text-slate-500">Waiting for earlier years</span>}
                </td>
                <td className="p-2">
                  {isDone || !batch ? null : isConfirming ? (
                    <div className="rounded-xl border-2 border-red-700 bg-red-50 p-3 dark:border-red-500 dark:bg-red-950/30">
                      <p className="font-black text-red-900 dark:text-red-200">Confirm: import {batch.count} row{batch.count === 1 ? "" : "s"} for {year} ({money(batch.incomeCents)} income / {money(batch.expenseCents)} expense)?</p>
                      <p className="mt-1 text-xs text-red-800 dark:text-red-300">The server recomputes this batch fresh from Rentec immediately before writing — a row that&apos;s no longer safe is rejected, not imported.</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={isApproving} onClick={() => confirmApprove(batch)} className="rounded-lg bg-red-700 px-4 py-2 text-xs font-black text-white transition hover:bg-red-800 disabled:opacity-50">Confirm approval</button>
                        <button type="button" disabled={isApproving} onClick={cancelConfirm} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" disabled={!isNext || approvingYear !== null} onClick={() => startConfirm(year)}
                      className={`rounded-lg px-4 py-2 text-xs font-black transition disabled:opacity-50 ${goldControlClassName}`}>
                      Approve {year}
                    </button>
                  )}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : null}
    </div>
  </section>;
}
