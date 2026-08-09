"use client";

import { useEffect, useState } from "react";

function formatCurrency(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(cents || 0) / 100);
}

export function displayObligationValue(value) {
  const labels = {
    property_tax: "Property tax",
    fire_insurance: "Fire insurance",
    windstorm_insurance: "Windstorm insurance",
    flood_insurance: "Flood insurance",
    bundled_fire_windstorm_insurance: "Fire and windstorm insurance",
    business_liability_insurance: "Business liability insurance",
    other_insurance: "Other insurance",
    accrual_ready: "Accrual ready",
    pending: "Dates needed",
    cash_only: "Cash only",
  };

  return labels[value] || String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function summarizeObligations(obligations = []) {
  return Object.freeze({
    total: obligations.length,
    accrualReady: obligations.filter(
      ({ recognitionStatus }) => recognitionStatus === "accrual_ready",
    ).length,
    pending: obligations.filter(
      ({ recognitionStatus }) => recognitionStatus === "pending",
    ).length,
    reconciled: obligations.filter(
      ({ reconciledFinancialEventId }) => Boolean(reconciledFinancialEventId),
    ).length,
  });
}

async function readJson(response) {
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to complete the operating-cost request.");
  }

  return payload;
}

function mergeObligations(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));

  for (const item of incoming) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort(
    (left, right) =>
      (left.propertyId || left.subjectLabel).localeCompare(
        right.propertyId || right.subjectLabel,
      ) || left.obligationType.localeCompare(right.obligationType),
  );
}

function ObligationRow({ obligation }) {
  const ready = obligation.recognitionStatus === "accrual_ready";

  return (
    <details className="group border-b border-slate-200 last:border-b-0">
      <summary className="grid cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[minmax(180px,1.4fr)_minmax(130px,1fr)_110px_125px_20px]">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-slate-950">
            {obligation.subjectLabel}
          </div>
          <div className="truncate text-xs text-slate-500">
            {obligation.propertyId || "Portfolio"}
          </div>
        </div>
        <div className="text-xs font-bold text-slate-700">
          {displayObligationValue(obligation.obligationType)}
        </div>
        <div className="text-sm font-black text-slate-950">
          {formatCurrency(obligation.annualAmountCents)}
        </div>
        <div className={`rounded-full border px-2 py-1 text-center text-[10px] font-black uppercase ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {displayObligationValue(obligation.recognitionStatus)}
        </div>
        <div className="text-slate-400 transition group-open:rotate-180">▾</div>
      </summary>
      <div className="grid gap-3 bg-slate-50 px-4 py-4 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
        <div><b>Coverage:</b><br />{obligation.servicePeriodStart && obligation.servicePeriodEnd ? `${obligation.servicePeriodStart} to ${obligation.servicePeriodEnd}` : "Policy dates needed"}</div>
        <div><b>Payment:</b><br />{obligation.paymentDate || "Not recorded"} · {formatCurrency(obligation.paidAmountCents)}</div>
        <div><b>Verification:</b><br />{displayObligationValue(obligation.verificationStatus)}</div>
        <div><b>Financial payment:</b><br />{obligation.reconciledFinancialEventId ? "Reconciled" : "Needs matching"}</div>
        {obligation.notes && <div className="sm:col-span-2 lg:col-span-4"><b>Notes:</b> {obligation.notes}</div>}
      </div>
    </details>
  );
}

export default function PropertyOperatingCostsPanel() {
  const [obligations, setObligations] = useState([]);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function initialize() {
      try {
        const response = await fetch("/api/property-operating-obligations");
        const payload = await readJson(response);
        setObligations(payload.obligations || []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to load operating costs.");
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, []);

  const summary = summarizeObligations(obligations);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    setError("");
    setMessage("");
    setPreview(null);

    if (!file) {
      setCsv("");
      setFileName("");
      return;
    }

    setWorking(true);
    setFileName(file.name);

    try {
      const contents = await file.text();
      setCsv(contents);
      const response = await fetch("/api/property-operating-obligations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "preview-spreadsheet",
          csv: contents,
          taxServiceYear: 2025,
        }),
      });
      const payload = await readJson(response);
      setPreview(payload.preview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to preview operating costs.");
    } finally {
      setWorking(false);
    }
  }

  async function handleImport() {
    if (!csv || !preview?.valid) return;
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/property-operating-obligations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "import-spreadsheet",
          csv,
          taxServiceYear: 2025,
        }),
      });
      const payload = await readJson(response);

      if (!payload.result.valid) {
        setPreview(payload.result);
        setError("Resolve invalid rows before importing.");
        return;
      }

      setObligations((current) => mergeObligations(current, payload.result.persistedObligations || []));
      setPreview(payload.result);
      setMessage(`${payload.result.importedCount} operating obligations imported.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to import operating costs.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section data-property-operating-costs-panel className="space-y-5">
      <header className="rounded-2xl border border-blue-200 bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">Property Operations</div>
        <h3 className="mt-2 text-2xl font-black">Taxes &amp; Insurance</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Maintain annual obligations once, reconcile cash payments, and accrue verified coverage into the correct property NOI.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</div>}

      <div className="grid gap-3 sm:grid-cols-4">
        {[["Obligations", summary.total], ["Accrual ready", summary.accrualReady], ["Dates needed", summary.pending], ["Reconciled", summary.reconciled]].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-black uppercase text-slate-500">{label}</div>
            <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">Ledger Import</div>
          <h4 className="mt-2 text-lg font-black text-slate-950">Preview taxes and insurance</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">Taxes use the confirmed tax year. Insurance stays outside accrued NOI until policy dates are verified.</p>
          <label className="mt-4 block">
            <span className="text-sm font-bold text-slate-700">Category ledger CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={handleFileChange} disabled={working} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          {fileName && <div className="mt-2 text-xs font-bold text-slate-500">{fileName}</div>}
          {working && <div className="mt-4 text-sm font-bold text-blue-700">Validating owner-scoped records…</div>}

          {preview && (
            <div className="mt-5 space-y-3">
              <div className="text-sm font-black">{preview.validRowCount} valid · {preview.invalidRowCount} invalid · {preview.warnings?.length || 0} warnings</div>
              {preview.errors?.map((item) => <div key={`e-${item.rowNumber}`} className="rounded-lg bg-rose-50 p-3 text-xs font-bold text-rose-800">Row {item.rowNumber}: {item.message}</div>)}
              {preview.warnings?.map((item) => <div key={`w-${item.rowNumber}-${item.code}`} className="rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800">Row {item.rowNumber}: {item.message}</div>)}
              <button type="button" onClick={handleImport} disabled={working || !preview.valid} className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40">Import verified preview</button>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase text-slate-500 sm:grid-cols-[minmax(180px,1.4fr)_minmax(130px,1fr)_110px_125px_20px]"><div>Property</div><div>Category</div><div>Annual</div><div>Status</div><div /></div>
          {loading && <div className="p-5 text-sm font-bold text-slate-600">Loading operating costs…</div>}
          {!loading && obligations.length === 0 && <div className="p-5 text-sm text-slate-600">No operating obligations have been imported.</div>}
          {obligations.map((item) => <ObligationRow key={item.id} obligation={item} />)}
        </div>
      </div>
    </section>
  );
}
