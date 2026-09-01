"use client";
import { useState } from "react";
import { BULK_INVENTORY_TEMPLATE } from "@/domains/reservations/bulkInventoryImport";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);

export default function ReservationInventoryBulkImport({ onImported }) {
  const [fileName, setFileName] = useState(""); const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState(null); const [token, setToken] = useState("");
  const [acknowledged, setAcknowledged] = useState(false); const [typed, setTyped] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  function resetConfirmation() { setPreview(null); setToken(""); setAcknowledged(false); setTyped(""); setMessage(""); }
  async function chooseFile(event) {
    const file = event.target.files?.[0]; resetConfirmation(); setFileName(file?.name || "");
    setCsvText(file ? await file.text() : "");
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([BULK_INVENTORY_TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "forge-rv-short-term-inventory-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  }
  async function request(operation) {
    setBusy(true); setMessage("");
    try {
      const body = operation === "preview" ? { operation, csvText } : { operation, previewToken: token, acknowledged, confirmationText: typed };
      const response = await fetch("/api/rental/reservations/inventory/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to process inventory import.");
      if (operation === "preview") { setPreview(payload.reconciliation); setToken(payload.previewToken || ""); }
      else { setMessage(`Imported ${payload.result.createdUnits} units and reservation inventory records.`); setPreview(null); setToken(""); setAcknowledged(false); setTyped(""); setCsvText(""); setFileName(""); await onImported?.(); }
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <section aria-label="Bulk reservation inventory import" className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">Bulk import RV spots and cabins</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create up to 500 Rental Manager units and reservation settings from one local CSV. Drivable RVs are excluded.</p></div><button type="button" onClick={downloadTemplate} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black dark:border-slate-600">Download CSV template</button></div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><label className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-black dark:bg-slate-800">Choose CSV<input className="sr-only" type="file" accept=".csv,text/csv" onChange={chooseFile}/></label><span className="text-sm text-slate-600 dark:text-slate-300">{fileName || "No file selected"}</span><button type="button" disabled={!csvText || busy} onClick={()=>request("preview")} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950">{busy ? "Working…" : "Preview import"}</button></div>
    {message && <p role="status" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm font-bold text-sky-900">{message}</p>}
    {preview && <div className="mt-4 space-y-3"><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><p className="text-xs font-bold uppercase">Rows</p><p className="text-xl font-black">{preview.totalRows}</p></div><div className="rounded-lg bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><p className="text-xs font-bold uppercase">Ready</p><p className="text-xl font-black">{preview.validRows}</p></div><div className="rounded-lg bg-red-50 p-3 text-red-900 dark:bg-red-950/30 dark:text-red-200"><p className="text-xs font-bold uppercase">Errors</p><p className="text-xl font-black">{preview.errorRows}</p></div></div>
      <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Row</th><th className="p-2">Property / unit</th><th className="p-2">Type</th><th className="p-2">Nightly</th><th className="p-2">Reconciliation</th></tr></thead><tbody>{preview.rows.map((row)=><tr key={row.rowNumber} className="border-t border-slate-200 dark:border-slate-700"><td className="p-2">{row.rowNumber}</td><td className="p-2"><strong>{row.propertyId}</strong><br/>{row.unitLabel}</td><td className="p-2">{row.inventory?.inventoryType || "—"}</td><td className="p-2">{row.inventory ? money(row.inventory.nightlyRateCents) : "—"}</td><td className={`p-2 font-bold ${row.errors.length ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>{row.errors.length ? row.errors.join(" ") : "Ready"}</td></tr>)}</tbody></table></div>
      {preview.errorRows === 0 && token && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-slate-950"><label className="flex gap-2 text-sm font-bold"><input type="checkbox" checked={acknowledged} onChange={(event)=>setAcknowledged(event.target.checked)}/>I reviewed every row and understand this creates Rental Manager units and reservation inventory.</label><label className="mt-3 block text-sm font-bold">Type IMPORT to confirm<input value={typed} onChange={(event)=>setTyped(event.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label><button type="button" disabled={busy || !acknowledged || typed !== "IMPORT"} onClick={()=>request("confirm")} className="mt-3 w-full rounded-lg bg-emerald-700 px-4 py-2 font-black text-white disabled:opacity-50">Import all units</button></div>}
    </div>}
  </section>;
}
