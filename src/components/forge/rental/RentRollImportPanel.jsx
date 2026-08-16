"use client";
import { useState } from "react";
import { buildRentRollImportPlan } from "@/domains/rentec-rental-migration/rentec-rent-roll-csv-import";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (cents == null ? "—" : money.format(cents / 100));

async function post(operation, extra) {
  const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...extra }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `${operation} failed.`);
  return result;
}

async function commitRow(row) {
  if (row.action === "add-deposit") {
    const { deposit } = await post("save-security-deposit", { deposit: { leaseId: row.existingLeaseId, tenantId: row.primaryTenantId, requiredAmountCents: row.depositCents } });
    await post("record-security-deposit-transaction", { transaction: { depositId: deposit.id, transactionType: "received", amountCents: row.depositCents, occurredAt: row.depositDate, description: "Historical deposit from Rentec rent roll import." } });
    return;
  }
  const { lease } = await post("save-lease", { lease: {
    propertyId: row.propertyId, unitId: row.unitId, tenantIds: row.tenantIds, status: "draft",
    startDate: row.startDate, endDate: row.endDate, monthlyRentCents: row.monthlyRentCents, currencyCode: "USD",
    rentDueDay: 1, notes: "Imported from Rentec rent roll CSV.",
  } });
  await post("save-schedule", { schedule: { leaseId: lease.id, status: "draft", amountCents: row.monthlyRentCents, currencyCode: "USD", dueDay: 1, effectiveStartDate: row.startDate, effectiveEndDate: row.endDate } });
  if (row.depositCents) {
    const { deposit } = await post("save-security-deposit", { deposit: { leaseId: lease.id, tenantId: row.tenantIds[0], requiredAmountCents: row.depositCents } });
    await post("record-security-deposit-transaction", { transaction: { depositId: deposit.id, transactionType: "received", amountCents: row.depositCents, occurredAt: row.depositDate, description: "Historical deposit from Rentec rent roll import." } });
  }
}

const ACTION_LABELS = { "new-lease": "New draft lease", "add-deposit": "Add deposit to existing lease", skip: "Skip", unmatched: "Needs manual review" };
const ACTION_STYLES = { "new-lease": "bg-emerald-100 text-emerald-800", "add-deposit": "bg-sky-100 text-sky-800", skip: "bg-slate-100 text-slate-600", unmatched: "bg-red-100 text-red-800" };

export default function RentRollImportPanel({ units, tenants, leases, onImported }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [selected, setSelected] = useState({});
  const [results, setResults] = useState({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setResults({});
    try {
      const text = await file.text();
      const nextPlan = buildRentRollImportPlan(text, { units, tenants, leases });
      setPlan(nextPlan);
      const nextSelected = {};
      nextPlan.rows.forEach((row, index) => { if (row.action === "new-lease" || row.action === "add-deposit") nextSelected[index] = true; });
      setSelected(nextSelected);
    } catch (reason) {
      setError(reason.message);
    } finally {
      event.target.value = "";
    }
  };

  const runImport = async () => {
    if (!plan) return;
    setImporting(true);
    const nextResults = {};
    for (const [index, row] of plan.rows.entries()) {
      if (!selected[index]) continue;
      try {
        await commitRow(row);
        nextResults[index] = { ok: true };
      } catch (reason) {
        nextResults[index] = { ok: false, message: reason.message };
      }
      setResults((current) => ({ ...current, [index]: nextResults[index] }));
    }
    setImporting(false);
    await onImported?.();
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">
        Import rent roll from CSV
      </button>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-700">Import rent roll from CSV</p>
        <button type="button" onClick={() => { setOpen(false); setPlan(null); setResults({}); }} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Upload Rentec's Rent Roll export. Everything imports as draft — nothing activates or bills automatically. Review the matches below before importing.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} className="mt-3 text-sm" />
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {plan && (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-2" />
                  <th className="p-2">Property</th>
                  <th className="p-2">Tenant</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Rent</th>
                  <th className="p-2">Deposit</th>
                  <th className="p-2">Dates</th>
                  <th className="p-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {plan.rows.map((row, index) => {
                  const actionable = row.action === "new-lease" || row.action === "add-deposit";
                  const result = results[index];
                  return (
                    <tr key={`${row.propertyLabel}-${row.tenantLabel}`} className="align-top">
                      <td className="p-2">
                        {actionable && <input type="checkbox" checked={!!selected[index]} disabled={importing} onChange={(event) => setSelected((current) => ({ ...current, [index]: event.target.checked }))} />}
                      </td>
                      <td className="p-2 font-bold">{row.propertyLabel}</td>
                      <td className="p-2">{row.tenantLabel}</td>
                      <td className="p-2"><span className={`rounded-full px-2 py-1 text-xs font-black ${ACTION_STYLES[row.action]}`}>{ACTION_LABELS[row.action]}</span></td>
                      <td className="p-2">{centsToMoney(row.monthlyRentCents)}</td>
                      <td className="p-2">{centsToMoney(row.depositCents)}</td>
                      <td className="p-2 text-xs text-slate-500">{row.startDate ? `${row.startDate} — ${row.endDate || "current"}` : "—"}</td>
                      <td className="p-2 text-xs text-slate-500">
                        {row.reason && <p>{row.reason}</p>}
                        {row.issues?.map((issue) => <p key={issue} className="text-amber-700">{issue}</p>)}
                        {result && (result.ok ? <p className="font-bold text-emerald-700">Imported.</p> : <p className="font-bold text-red-700">{result.message}</p>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={importing} onClick={runImport} className="mt-4 rounded-xl bg-slate-950 px-5 py-2.5 font-black text-white disabled:opacity-50">
            {importing ? "Importing…" : `Import ${Object.values(selected).filter(Boolean).length} selected row(s)`}
          </button>
        </>
      )}
    </div>
  );
}
