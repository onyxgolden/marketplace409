"use client";
import { useState } from "react";
import RentecExceptionReview from "./RentecExceptionReview.jsx";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export default function RentecMigrationPanel() {
  const [preview, setPreview] = useState(null);
  const [apiPreview, setApiPreview] = useState(null);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function apiRequest(body) {
    const response = await fetch("/api/rental/rentec-api-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    return payload.data;
  }

  async function inspectApi() {
    setBusy(true); setMessage(""); setApiPreview(null);
    try {
      const inventory = await apiRequest({ operation: "inventory" });
      const totals = { transactionRecords: 0, netTransactionCents: 0, unassignedTransactions: 0, transactionPages: 0, matchedTenantIds: new Set(), reconciliationFingerprints: [] };
      let completed = 0;
      const propertyNames = new Map((inventory.propertyReferences || []).map((property) => [property.id, property.label]));
      for (const propertyId of inventory.propertyIds) {
        let page = 1; let more = true;
        while (more) {
          setProgress(`Reading property ${completed + 1} of ${inventory.propertyIds.length}, page ${page}…`);
          const result = await apiRequest({ operation: "transactions", propertyId, propertyName: propertyNames.get(propertyId) || "", page });
          totals.transactionRecords += result.records;
          totals.netTransactionCents += result.totalCents;
          totals.unassignedTransactions += result.unassignedTransactions;
          totals.transactionPages++;
          totals.reconciliationFingerprints.push(...result.reconciliationFingerprints);
          Object.keys(result.renterTransactionCounts).forEach((id) => totals.matchedTenantIds.add(id));
          more = result.moreRecords; page++;
          if (more) await wait(1100);
        }
        completed++;
        if (completed < inventory.propertyIds.length) await wait(1100);
      }
      setProgress("Comparing current Rentec transactions with the legacy Rentec export…");
      const legacyReconciliation = await apiRequest({ operation: "reconcile-legacy", fingerprints: totals.reconciliationFingerprints });
      setApiPreview({ ...inventory, ...totals, reconciliationFingerprints: undefined, legacyReconciliation, matchedTenantIds: totals.matchedTenantIds.size });
      setProgress("");
    } catch (error) { setMessage(error.message); setProgress(""); }
    finally { setBusy(false); }
  }

  async function inspectCsv(event) {
    const selected = [...(event.target.files || [])];
    setPreview(null); setMessage("");
    if (!selected.length) return;
    setBusy(true);
    try {
      const files = await Promise.all(selected.map(async (file) => ({ name: file.name, csv: await file.text() })));
      const response = await fetch("/api/rental/rentec-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPreview(body.data);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  const reconciliation = apiPreview?.legacyReconciliation;
  return <section className="space-y-5">
    <div className="rounded-2xl border bg-white p-6">
      <p className="text-sm font-bold uppercase tracking-widest text-sky-700">Migration</p>
      <h2 className="mt-2 text-2xl font-black">Import from Rentec Direct</h2>
      <p className="mt-2 max-w-3xl text-slate-600">Connect read-only to inventory every property, renter, lease, and transaction page, then compare transaction fingerprints with the legacy Rentec financial export before any FORGE record is created.</p>
      <button type="button" disabled={busy} onClick={inspectApi} className="mt-5 rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{busy ? "Inspecting…" : "Inspect Rentec account"}</button>
      <p className="mt-3 text-sm font-bold text-amber-800">Preview only: this screen cannot write Rentec or FORGE records.</p>
      {progress ? <p role="status" className="mt-4">{progress}</p> : null}
      {message ? <p role="alert" className="mt-4 text-red-700">{message}</p> : null}
      {apiPreview ? <div className="mt-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Properties", apiPreview.properties], ["Renters", apiPreview.tenants], ["Leases", apiPreview.leases], ["Transactions", apiPreview.transactionRecords]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-black uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>)}</div>
        <div className="rounded-xl border p-4"><h3 className="font-black">Read-only reconciliation inventory</h3><p className="mt-2 text-sm">Archived renters: {apiPreview.archivedTenants}</p><p className="mt-2 text-sm">Renters linked to transactions: {apiPreview.matchedTenantIds}</p><p className="mt-2 text-sm">Transactions without a renter link: {apiPreview.unassignedTransactions}</p><p className="mt-2 text-sm">Transaction pages read: {apiPreview.transactionPages}</p><p className="mt-2 text-sm">Net transaction value: {money(apiPreview.netTransactionCents)}</p></div>
        {reconciliation ? <div className="rounded-xl border p-4"><h3 className="font-black">Legacy Rentec export comparison</h3><p className="mt-2 text-sm">Already represented: {reconciliation.alreadyRepresented}</p><p className="mt-2 text-sm">Probable matches requiring review: {reconciliation.probableMatch}</p><p className="mt-2 text-sm">Probable matches supported by property evidence: {reconciliation.propertySupportedMatch}</p><p className="mt-2 text-sm">Conflicting amount candidates: {reconciliation.conflicting}</p><p className="mt-2 text-sm">New API transactions: {reconciliation.newFromApi}</p><p className="mt-2 text-sm">Legacy-only financial events: {reconciliation.legacyOnly}</p><p className="mt-3 text-sm font-bold text-amber-800">Dry run only: legacy financial events remain accounting history and will not be copied into Rental Manager.</p></div> : null}
        <RentecExceptionReview review={reconciliation?.exceptionReview}/>
      </div> : null}
    </div>
    <details className="rounded-2xl border bg-white p-6"><summary className="cursor-pointer font-black">CSV backup and reconciliation</summary><p className="mt-3 text-sm text-slate-600">Use exported tenant-list and tenant-ledger CSV files only when API records require secondary evidence.</p><input className="mt-3 block w-full" type="file" accept=".csv,text/csv" multiple onChange={inspectCsv}/>{preview ? <p className="mt-3 text-sm font-bold">Recognized {preview.inventory.tenantRows} renter rows and {preview.inventory.ledgerRows} ledger rows.</p> : null}</details>
  </section>;
}
