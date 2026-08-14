"use client";

import { useState } from "react";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const formatBytes = (bytes) => new Intl.NumberFormat("en-US", { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(Number(bytes || 0) / 1_000_000);

export default function RentecFileInventoryPanel() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [inventory, setInventory] = useState(null);

  async function apiRequest(body) {
    const response = await fetch("/api/rental/rentec-api-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    return payload.data;
  }

  async function inspectFiles() {
    setBusy(true);
    setMessage("");
    setInventory(null);
    try {
      const account = await apiRequest({ operation: "inventory" });
      const targets = [
        { associationType: "all", associationId: "", label: "account" },
        ...account.propertyIds.map((associationId) => ({ associationType: "property", associationId, label: "property" })),
        ...account.tenantIds.map((associationId) => ({ associationType: "renter", associationId, label: "renter" })),
      ];
      const files = new Map();
      const cappedQueries = [];
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        setProgress(`Reading ${target.label} file index ${index + 1} of ${targets.length}…`);
        const result = await apiRequest({ operation: "files", associationType: target.associationType, associationId: target.associationId });
        result.files.forEach((file) => files.set(file.id, file));
        if (result.capped) cappedQueries.push(result.query);
        if (index < targets.length - 1) await wait(1100);
      }
      const extensions = {};
      const associations = {};
      let totalBytes = 0;
      files.forEach((file) => {
        totalBytes += file.bytes;
        extensions[file.extension] = (extensions[file.extension] || 0) + 1;
        associations[file.association] = (associations[file.association] || 0) + 1;
      });
      setInventory({ files: files.size, totalBytes, extensions, associations, queries: targets.length, cappedQueries: cappedQueries.length });
      setProgress("");
    } catch (error) {
      setMessage(error.message);
      setProgress("");
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-5">
    <div className="rounded-2xl border bg-white p-6">
      <p className="text-sm font-bold uppercase tracking-widest text-sky-700">Migration evidence</p>
      <h2 className="mt-2 text-2xl font-black">Rentec files and renter photos</h2>
      <p className="mt-2 max-w-3xl text-slate-600">Inventory private renter photos, property photos, leases, receipts, and other evidence before secure storage capabilities are created.</p>
      <button type="button" disabled={busy} onClick={inspectFiles} className="mt-5 rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{busy ? "Inspecting files…" : "Inspect Rentec files"}</button>
      <p className="mt-3 text-sm font-bold text-amber-800">Preview only: file names and contents are not returned, downloaded, or written to FORGE.</p>
      {progress ? <p role="status" className="mt-4">{progress}</p> : null}
      {message ? <p role="alert" className="mt-4 text-red-700">{message}</p> : null}
      {inventory ? <div className="mt-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[['Distinct API file records', inventory.files], ['Discovered size', formatBytes(inventory.totalBytes)], ['Queries read', inventory.queries], ['Capped queries', inventory.cappedQueries]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-black uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border p-4"><h3 className="font-black">File types</h3>{Object.entries(inventory.extensions).sort().map(([name, count]) => <p key={name} className="mt-2 text-sm">{name}: {count}</p>)}</div>
          <div className="rounded-xl border p-4"><h3 className="font-black">Record associations</h3>{Object.entries(inventory.associations).sort().map(([name, count]) => <p key={name} className="mt-2 text-sm">{name.replaceAll('_', ' ')}: {count}</p>)}</div>
        </div>
        {inventory.cappedQueries ? <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">This is a minimum inventory. At least one Rentec query reached its non-paginated 100-record limit, so FORGE cannot claim the file inventory is complete until it is reconciled against Rentec or an export.</p> : null}
      </div> : null}
    </div>
  </section>;
}
