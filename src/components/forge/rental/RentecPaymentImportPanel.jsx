"use client";
import { useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);

const REVIEW_SECTIONS = [
  { classification: "ambiguous", label: "Ambiguous — requires review", tone: "amber" },
  { classification: "conflict", label: "Conflict — would overpay a charge", tone: "red" },
  { classification: "unmatched", label: "Unmatched — no linked FORGE charge", tone: "slate" },
  { classification: "ignored_non_rent", label: "Ignored — not a rent payment", tone: "slate" },
  { classification: "already_imported", label: "Already imported", tone: "emerald" },
];

export default function RentecPaymentImportPanel({ onNavigate } = {}) {
  const [properties, setProperties] = useState(null); // null = still loading; [] = loaded, empty
  const [propertiesError, setPropertiesError] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [importBatchId, setImportBatchId] = useState(null);
  const [rentecPropertyId, setRentecPropertyId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveResults, setApproveResults] = useState(null);

  // Reads FORGE's own already-imported linkage data only — never calls Rentec. The first (and
  // only) Rentec call happens when the landlord explicitly clicks "Preview Rentec payments" below.
  useEffect(() => {
    fetch("/api/rental/rentec-linked-properties").then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setProperties(body.properties);
    }).catch((error) => setPropertiesError(error.message));
  }, []);

  const matchedItems = (preview?.items || []).filter((item) => item.classification === "matched");

  async function runPreview(event) {
    event.preventDefault();
    if (!selectedPropertyId) return;
    setBusy(true); setMessage(""); setPreview(null); setImportBatchId(null); setRentecPropertyId(null); setApproveResults(null); setConfirming(false);
    try {
      const response = await fetch("/api/rental/rentec-payment-import-preview", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: selectedPropertyId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPreview(body.preview);
      setImportBatchId(body.importBatchId);
      setRentecPropertyId(body.rentecPropertyId);
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
    // client-submitted financial fact. propertyId here is the Rentec id already resolved
    // server-side during preview — the browser never handles or edits the raw Rentec id itself.
    const approvals = matchedItems.filter((item) => selected.has(item.transactionId))
      .map((item) => ({ transactionId: item.transactionId, leaseId: item.leaseId, chargeId: item.chargeId }));
    if (approvals.length === 0) return;
    setApproving(true); setMessage(""); setApproveResults(null);
    try {
      const response = await fetch("/api/rental/rentec-payment-import-approve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ importBatchId, propertyId: rentecPropertyId, approvals }),
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

  return <section className="space-y-6" data-rentec-payment-import>
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Reconciliation</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Import Rentec payments</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
        Preview rent payments already collected through Rentec for one property and, on your explicit approval,
        record them against the matching FORGE rent charge so an externally managed lease's balance is accurate.
        This never changes a lease's collection authority, cutover date, or global billing state, and Rentec is
        never written to.
      </p>

      {propertiesError ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{propertiesError}</p> : null}

      {properties === null ? <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">Loading your Rentec-linked properties…</p> : properties.length === 0 ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">No properties are linked to Rentec yet.</p>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">Import or link a property from Rentec Migration before you can preview its payments here.</p>
          <button type="button" onClick={() => onNavigate?.("rentec-migration")} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">
            Go to Rentec Migration
          </button>
        </div>
      ) : (
        <form onSubmit={runPreview} className="mt-5 flex flex-wrap items-end gap-3">
          <label className="text-sm font-bold text-slate-900 dark:text-white">Property
            <select value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)} required
              className="mt-1 block w-64 rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              <option value="">Choose a property…</option>
              {properties.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !selectedPropertyId} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
            {busy ? "Previewing…" : "Preview Rentec payments"}
          </button>
        </form>
      )}
      <p className="mt-3 text-sm font-bold text-amber-800 dark:text-amber-400">Preview only: this never writes anything. Approving matched payments below is the only action on this page that writes anything.</p>

      {message ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{message}</p> : null}

      {preview ? <div className="mt-6 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Object.entries(preview.classificationCounts).map(([classification, count]) => (
            <div key={classification} className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
              <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{classification.replaceAll("_", " ")}</p>
              <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{count}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border-2 border-slate-950 p-4 dark:border-amber-400">
          <h3 className="font-black text-slate-950 dark:text-white">Matched transactions</h3>
          {matchedItems.length === 0 ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No matched transactions in this preview.</p> : <>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="p-2"></th><th className="p-2 text-slate-700 dark:text-slate-300">Transaction</th><th className="p-2 text-slate-700 dark:text-slate-300">Charge</th><th className="p-2 text-slate-700 dark:text-slate-300">Amount</th><th className="p-2 text-slate-700 dark:text-slate-300">Partial?</th></tr></thead>
                <tbody>
                  {matchedItems.map((item) => (
                    <tr key={item.transactionId} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                      <td className="p-2"><input type="checkbox" checked={selected.has(item.transactionId)} onChange={() => toggleSelected(item.transactionId)} /></td>
                      <td className="p-2 font-mono text-xs text-slate-600 dark:text-slate-400">{item.transactionId}</td>
                      <td className="p-2 font-mono text-xs text-slate-600 dark:text-slate-400">{item.chargeId}</td>
                      <td className="p-2 font-bold tabular-nums text-slate-950 dark:text-white">{money(item.amountCents)}</td>
                      <td className="p-2 text-slate-700 dark:text-slate-300">{item.isPartial ? "Partial" : "Full"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!confirming ? (
              <button type="button" disabled={selectedCount === 0} onClick={() => setConfirming(true)}
                className={`mt-4 rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
                Approve {selectedCount} matched payment{selectedCount === 1 ? "" : "s"}
              </button>
            ) : (
              <div className="mt-4 rounded-xl border-2 border-red-700 bg-red-50 p-4 dark:border-red-500 dark:bg-red-950/30">
                <p className="font-black text-red-900 dark:text-red-200">Confirm: record {selectedCount} payment{selectedCount === 1 ? "" : "s"} totaling {money(selectedTotalCents)}?</p>
                <p className="mt-2 text-sm text-red-800 dark:text-red-300">Every match is rechecked against the current charge balance before it is applied — a stale or already-settled charge will be rejected, not overpaid. This does not activate FORGE billing for any lease.</p>
                <div className="mt-3 flex gap-3">
                  <button type="button" disabled={approving} onClick={approveSelected} className="rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white transition hover:bg-red-800 disabled:opacity-50">{approving ? "Recording…" : "Confirm approval"}</button>
                  <button type="button" disabled={approving} onClick={() => setConfirming(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                </div>
              </div>
            )}
          </>}
        </div>

        {REVIEW_SECTIONS.map(({ classification, label }) => {
          const rows = (preview.items || []).filter((item) => item.classification === classification);
          if (rows.length === 0) return null;
          return <details key={classification} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <summary className="cursor-pointer font-black text-slate-950 dark:text-white">{label} ({rows.length})</summary>
            <ul className="mt-3 space-y-2 text-sm">
              {rows.map((item) => <li key={item.transactionId} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{item.transactionId}</span>
                {item.reason ? <span className="block text-slate-600 dark:text-slate-400">{item.reason}</span> : null}
              </li>)}
            </ul>
          </details>;
        })}

        {approveResults ? <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="font-black text-slate-950 dark:text-white">Approval results</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {approveResults.map((result) => <li key={result.transactionId} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{result.transactionId}</span>
              <span className={`font-bold ${result.status === "applied" ? "text-emerald-700 dark:text-emerald-400" : result.status === "already_applied" ? "text-slate-500 dark:text-slate-400" : "text-red-700 dark:text-red-400"}`}>
                {result.status.replaceAll("_", " ")}{result.reason ? ` — ${result.reason}` : ""}
              </span>
            </li>)}
          </ul>
        </div> : null}
      </div> : null}
    </div>
  </section>;
}
