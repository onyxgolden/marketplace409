"use client";
import { useState } from "react";
import RentecExceptionReview from "./RentecExceptionReview.jsx";
import RentecOperationalMigrationPlan from "./RentecOperationalMigrationPlan.jsx";
import RentecImportManifestPreview from "./RentecImportManifestPreview.jsx";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export default function RentecMigrationPanel() {
  const [preview, setPreview] = useState(null);
  const [apiPreview, setApiPreview] = useState(null);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [ownerInputs, setOwnerInputs] = useState({ tenantEmails: {}, tenantExclusions: {}, tenantClassifications: {}, leaseRentDueDays: {} });
  const [busy, setBusy] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [propertyManifest, setPropertyManifest] = useState(null);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [commitError, setCommitError] = useState("");

  async function apiRequest(body) {
    const response = await fetch("/api/rental/rentec-api-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    return payload.data;
  }

  async function inspectApi() {
    setBusy(true); setMessage(""); setApiPreview(null); setOwnerInputs({ tenantEmails: {}, tenantExclusions: {}, tenantClassifications: {}, leaseRentDueDays: {} });
    setSelectedPropertyId(""); setPropertyManifest(null); setCommitResult(null); setCommitError(""); setConfirmingImport(false);
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
      setProgress("Building transaction reconciliation and operational migration plans…");
      const [legacyReconciliation, operationalPlan, importManifest] = await Promise.all([
        apiRequest({ operation: "reconcile-legacy", fingerprints: totals.reconciliationFingerprints }),
        apiRequest({ operation: "plan-operational" }),
        apiRequest({ operation: "manifest-preview" }),
      ]);
      setApiPreview({ ...inventory, ...totals, reconciliationFingerprints: undefined, legacyReconciliation, operationalPlan, importManifest, matchedTenantIds: totals.matchedTenantIds.size });
      setProgress("");
    } catch (error) { setMessage(error.message); setProgress(""); }
    finally { setBusy(false); }
  }

  async function resolveManifest(nextInputs) {
    const mergedInputs = {
      tenantEmails: { ...ownerInputs.tenantEmails, ...nextInputs.tenantEmails },
      tenantExclusions: { ...ownerInputs.tenantExclusions, ...nextInputs.tenantExclusions },
      tenantClassifications: { ...ownerInputs.tenantClassifications, ...nextInputs.tenantClassifications },
      leaseRentDueDays: { ...ownerInputs.leaseRentDueDays, ...nextInputs.leaseRentDueDays },
    };
    setBusy(true); setMessage("");
    try {
      const importManifest = await apiRequest({ operation: "resolve-manifest-preview", ownerInputs: mergedInputs });
      setOwnerInputs(mergedInputs);
      setApiPreview((current) => ({ ...current, importManifest }));
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function previewProperty(propertyId) {
    setSelectedPropertyId(propertyId);
    setPropertyManifest(null); setCommitResult(null); setCommitError(""); setConfirmingImport(false);
    if (!propertyId) return;
    setBusy(true); setMessage("");
    try {
      const manifest = await apiRequest({ operation: "resolve-manifest-preview", propertyId, ownerInputs });
      setPropertyManifest(manifest);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function resolvePropertyManifest(nextInputs) {
    const mergedInputs = {
      tenantEmails: { ...ownerInputs.tenantEmails, ...nextInputs.tenantEmails },
      tenantExclusions: { ...ownerInputs.tenantExclusions, ...nextInputs.tenantExclusions },
      tenantClassifications: { ...ownerInputs.tenantClassifications, ...nextInputs.tenantClassifications },
      leaseRentDueDays: { ...ownerInputs.leaseRentDueDays, ...nextInputs.leaseRentDueDays },
    };
    setBusy(true); setMessage("");
    try {
      const manifest = await apiRequest({ operation: "resolve-manifest-preview", propertyId: selectedPropertyId, ownerInputs: mergedInputs });
      setOwnerInputs(mergedInputs);
      setPropertyManifest(manifest);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function approveImport() {
    if (!propertyManifest || !selectedPropertyId) return;
    setCommitting(true); setCommitError(""); setCommitResult(null);
    try {
      const response = await fetch("/api/rental/rentec-commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId: selectedPropertyId, expectedChecksum: propertyManifest.checksum, ownerInputs }),
      });
      const body = await response.json();
      if (!response.ok) { setCommitError(body.error || "Unable to commit this import."); return; }
      setCommitResult(body.result);
      setPropertyManifest(null);
      setConfirmingImport(false);
    } catch (error) { setCommitError(error.message); }
    finally { setCommitting(false); }
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
  const selectedPropertyLabel = apiPreview?.propertyReferences?.find((row) => row.id === selectedPropertyId)?.label || selectedPropertyId;
  const propertyReadyToImport = propertyManifest && !propertyManifest.blockers?.length
    && (propertyManifest.privateRecordCounts.units + propertyManifest.privateRecordCounts.tenants + propertyManifest.privateRecordCounts.leases > 0);

  return <section className="space-y-5">
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Migration</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Import from Rentec Direct</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">Connect read-only to inventory every property, renter, lease, and transaction page, then compare transaction fingerprints with the legacy Rentec financial export and build a read-only operational migration plan and controlled import manifest before any FORGE record is created.</p>
      <button type="button" disabled={busy} onClick={inspectApi} className={`mt-5 rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{busy ? "Inspecting…" : "Inspect Rentec account"}</button>
      <p className="mt-3 text-sm font-bold text-amber-800 dark:text-amber-400">Preview only: this screen cannot write Rentec or FORGE records.</p>
      {progress ? <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-400">{progress}</p> : null}
      {message ? <p role="alert" className="mt-4 text-sm font-bold text-red-700 dark:text-red-400">{message}</p> : null}
      {apiPreview ? <div className="mt-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Properties", apiPreview.properties], ["Renters", apiPreview.tenants], ["Leases", apiPreview.leases], ["Transactions", apiPreview.transactionRecords]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800"><p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{value}</p></div>)}</div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-black text-slate-950 dark:text-white">Read-only reconciliation inventory</h3><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Archived renters: {apiPreview.archivedTenants}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Renters linked to transactions: {apiPreview.matchedTenantIds}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Transactions without a renter link: {apiPreview.unassignedTransactions}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Transaction pages read: {apiPreview.transactionPages}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Net transaction value: {money(apiPreview.netTransactionCents)}</p></div>
        {reconciliation ? <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-black text-slate-950 dark:text-white">Legacy Rentec export comparison</h3><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Already represented: {reconciliation.alreadyRepresented}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Probable matches requiring review: {reconciliation.probableMatch}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Probable matches supported by property evidence: {reconciliation.propertySupportedMatch}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Conflicting amount candidates: {reconciliation.conflicting}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">New API transactions: {reconciliation.newFromApi}</p><p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Legacy-only financial events: {reconciliation.legacyOnly}</p><p className="mt-3 text-sm font-bold text-amber-800 dark:text-amber-400">Dry run only: legacy financial events remain accounting history and will not be copied into Rental Manager.</p></div> : null}
        <RentecOperationalMigrationPlan plan={apiPreview.operationalPlan}/>
        <RentecImportManifestPreview manifest={apiPreview.importManifest} busy={busy} onResolve={resolveManifest}/>
        <RentecExceptionReview review={reconciliation?.exceptionReview}/>

        <div className="rounded-2xl border-2 border-slate-950 p-4 dark:border-amber-400">
          <h3 className="font-black text-slate-950 dark:text-white">Import one property</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Choose a single property to review and, if you approve it, actually create its records in Rental Manager. This is the only action on this page that writes anything — everything else above remains preview only.</p>
          <label className="mt-4 block text-sm font-bold text-slate-900 dark:text-white">
            Property
            <select
              className="mt-1 block w-full max-w-md rounded-xl border border-slate-300 bg-white p-3 font-bold dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              value={selectedPropertyId}
              disabled={busy || committing}
              onChange={(event) => previewProperty(event.target.value)}
            >
              <option value="">Choose a property…</option>
              {(apiPreview.propertyReferences || []).map((property) => (
                <option key={property.id} value={property.id}>{property.label}</option>
              ))}
            </select>
          </label>

          {propertyManifest ? <div className="mt-4 space-y-4">
            <RentecImportManifestPreview manifest={propertyManifest} busy={busy} onResolve={resolvePropertyManifest}/>

            {propertyManifest.blockers?.length ? (
              <p className="rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Resolve the blocking owner inputs above before this property can be imported.</p>
            ) : !propertyReadyToImport ? (
              <p className="rounded-xl bg-slate-100 p-4 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">Every record for {selectedPropertyLabel} already exists in Rental Manager — there is nothing new to import.</p>
            ) : !confirmingImport ? (
              <button type="button" disabled={committing} onClick={() => setConfirmingImport(true)} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
                Approve and import {selectedPropertyLabel}
              </button>
            ) : (
              <div className="rounded-xl border-2 border-red-700 bg-red-50 p-4 dark:border-red-500 dark:bg-red-950/30">
                <p className="font-black text-red-900 dark:text-red-200">Confirm: create real Rental Manager records for {selectedPropertyLabel}?</p>
                <p className="mt-2 text-sm text-red-800 dark:text-red-300">This creates {propertyManifest.privateRecordCounts.units} unit(s), {propertyManifest.privateRecordCounts.tenants} tenant(s), and {propertyManifest.privateRecordCounts.leases} lease(s) as draft — leases stay draft and cannot activate billing, portals, or autopay. This cannot be undone from this screen.</p>
                <div className="mt-3 flex gap-3">
                  <button type="button" disabled={committing} onClick={approveImport} className="rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white transition hover:bg-red-800 disabled:opacity-50">{committing ? "Importing…" : "Confirm import"}</button>
                  <button type="button" disabled={committing} onClick={() => setConfirmingImport(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                </div>
              </div>
            )}
          </div> : null}

          {commitError ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{commitError}</p> : null}
          {commitResult ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">Imported {selectedPropertyLabel}: {commitResult.unitsCreated} unit(s), {commitResult.tenantsCreated} tenant(s), {commitResult.leasesCreated} lease(s) created.</p> : null}
        </div>
      </div> : null}
    </div>
    <details className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"><summary className="cursor-pointer font-black text-slate-950 dark:text-white">CSV backup and reconciliation</summary><p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Use exported tenant-list and tenant-ledger CSV files only when API records require secondary evidence.</p><input className="mt-3 block w-full text-sm text-slate-700 dark:text-slate-300" type="file" accept=".csv,text/csv" multiple onChange={inspectCsv}/>{preview ? <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-200">Recognized {preview.inventory.tenantRows} renter rows and {preview.inventory.ledgerRows} ledger rows.</p> : null}</details>
  </section>;
}
