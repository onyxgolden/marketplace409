"use client";
import { useState } from "react";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);

const REVIEW_SECTIONS = [
  { classification: "ambiguous", label: "Ambiguous — requires review", tone: "amber" },
  { classification: "conflict", label: "Conflict — would overpay a charge", tone: "red" },
  { classification: "unmatched", label: "Unmatched — no linked FORGE charge", tone: "slate" },
  { classification: "ignored_non_rent", label: "Ignored — not a rent payment", tone: "slate" },
  { classification: "already_imported", label: "Already imported", tone: "emerald" },
];

export default function RentecPaymentImportPanel() {
  const [propertyId, setPropertyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [importBatchId, setImportBatchId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveResults, setApproveResults] = useState(null);

  const matchedItems = (preview?.items || []).filter((item) => item.classification === "matched");

  async function runPreview(event) {
    event.preventDefault();
    setBusy(true); setMessage(""); setPreview(null); setImportBatchId(null); setApproveResults(null); setConfirming(false);
    try {
      const response = await fetch("/api/rental/rentec-payment-import-preview", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPreview(body.preview);
      setImportBatchId(body.importBatchId);
      setSelected(new Set((body.preview.items || []).filter((item) => item.classification === "matched").map((item) => item.transactionId)));
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  function toggleSelected(transactionId) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(transactionId)) next.delete(transactionId); else next.add(transactionId);
      return next;
    });
  }

  async function approveSelected() {
    if (!importBatchId) return;
    // Only the mapping the landlord reviewed and picked (which transaction, which charge) is sent —
    // the server re-fetches the real Rentec amount/date/category itself and never trusts a
    // client-submitted financial fact.
    const approvals = matchedItems.filter((item) => selected.has(item.transactionId))
      .map((item) => ({ transactionId: item.transactionId, leaseId: item.leaseId, chargeId: item.chargeId }));
    if (approvals.length === 0) return;
    setApproving(true); setMessage(""); setApproveResults(null);
    try {
      const response = await fetch("/api/rental/rentec-payment-import-approve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ importBatchId, propertyId, approvals }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setApproveResults(body.results);
      setConfirming(false);
    } catch (error) { setMessage(error.message); }
    finally { setApproving(false); }
  }

  const selectedCount = matchedItems.filter((item) => selected.has(item.transactionId)).length;
  const selectedTotalCents = matchedItems.filter((item) => selected.has(item.transactionId)).reduce((sum, item) => sum + item.amountCents, 0);

  return <section className="rounded-2xl border bg-white p-6">
    <p className="text-sm font-bold uppercase tracking-widest text-sky-700">Reconciliation</p>
    <h2 className="mt-2 text-2xl font-black">Import Rentec payments</h2>
    <p className="mt-2 max-w-3xl text-slate-600">
      Preview rent payments already collected through Rentec for one property and, on your explicit approval,
      record them against the matching FORGE rent charge so an externally managed lease's balance is accurate.
      This never changes a lease's collection authority, cutover date, or global billing state, and Rentec is
      never written to.
    </p>

    <form onSubmit={runPreview} className="mt-5 flex flex-wrap items-end gap-3">
      <label className="text-sm font-bold">Rentec property ID
        <input value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required
          className="mt-1 block w-48 rounded-xl border border-slate-300 p-3 font-normal" placeholder="e.g. 10" />
      </label>
      <button type="submit" disabled={busy} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">
        {busy ? "Previewing…" : "Preview Rentec payments"}
      </button>
    </form>
    <p className="mt-3 text-sm font-bold text-amber-800">Preview only: this never writes anything. Approving matched payments below is the only action on this page that writes anything.</p>

    {message ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800">{message}</p> : null}

    {preview ? <div className="mt-6 space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Object.entries(preview.classificationCounts).map(([classification, count]) => (
          <div key={classification} className="rounded-xl bg-slate-100 p-4">
            <p className="text-xs font-black uppercase text-slate-500">{classification.replaceAll("_", " ")}</p>
            <p className="mt-1 text-xl font-black">{count}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border-2 border-slate-950 p-4">
        <h3 className="font-black">Matched transactions</h3>
        {matchedItems.length === 0 ? <p className="mt-2 text-sm text-slate-500">No matched transactions in this preview.</p> : <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b"><th className="p-2"></th><th className="p-2">Transaction</th><th className="p-2">Charge</th><th className="p-2">Amount</th><th className="p-2">Partial?</th></tr></thead>
              <tbody>
                {matchedItems.map((item) => (
                  <tr key={item.transactionId} className="border-b">
                    <td className="p-2"><input type="checkbox" checked={selected.has(item.transactionId)} onChange={() => toggleSelected(item.transactionId)} /></td>
                    <td className="p-2 font-mono text-xs">{item.transactionId}</td>
                    <td className="p-2 font-mono text-xs">{item.chargeId}</td>
                    <td className="p-2 font-bold">{money(item.amountCents)}</td>
                    <td className="p-2">{item.isPartial ? "Partial" : "Full"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!confirming ? (
            <button type="button" disabled={selectedCount === 0} onClick={() => setConfirming(true)}
              className="mt-4 rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">
              Approve {selectedCount} matched payment{selectedCount === 1 ? "" : "s"}
            </button>
          ) : (
            <div className="mt-4 rounded-xl border-2 border-red-700 bg-red-50 p-4">
              <p className="font-black text-red-900">Confirm: record {selectedCount} payment{selectedCount === 1 ? "" : "s"} totaling {money(selectedTotalCents)}?</p>
              <p className="mt-2 text-sm text-red-800">Every match is rechecked against the current charge balance before it is applied — a stale or already-settled charge will be rejected, not overpaid. This does not activate FORGE billing for any lease.</p>
              <div className="mt-3 flex gap-3">
                <button type="button" disabled={approving} onClick={approveSelected} className="rounded-xl bg-red-700 px-5 py-3 font-black text-white disabled:opacity-50">{approving ? "Recording…" : "Confirm approval"}</button>
                <button type="button" disabled={approving} onClick={() => setConfirming(false)} className="rounded-xl border border-slate-300 px-5 py-3 font-black">Cancel</button>
              </div>
            </div>
          )}
        </>}
      </div>

      {REVIEW_SECTIONS.map(({ classification, label }) => {
        const rows = (preview.items || []).filter((item) => item.classification === classification);
        if (rows.length === 0) return null;
        return <details key={classification} className="rounded-xl border p-4">
          <summary className="cursor-pointer font-black">{label} ({rows.length})</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {rows.map((item) => <li key={item.transactionId} className="rounded-lg bg-slate-50 p-3">
              <span className="font-mono text-xs">{item.transactionId}</span>
              {item.reason ? <span className="block text-slate-600">{item.reason}</span> : null}
            </li>)}
          </ul>
        </details>;
      })}

      {approveResults ? <div className="rounded-xl border p-4">
        <h3 className="font-black">Approval results</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {approveResults.map((result) => <li key={result.transactionId} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 p-3">
            <span className="font-mono text-xs">{result.transactionId}</span>
            <span className={`font-bold ${result.status === "applied" ? "text-emerald-700" : result.status === "already_applied" ? "text-slate-500" : "text-red-700"}`}>
              {result.status.replaceAll("_", " ")}{result.reason ? ` — ${result.reason}` : ""}
            </span>
          </li>)}
        </ul>
      </div> : null}
    </div> : null}
  </section>;
}
