"use client";
import { Fragment, useCallback, useMemo, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ASSET_CATEGORIES, DEPRECIATION_METHODS } from "@/domains/rental-depreciation/depreciation";

// Rentec parity R19: per-property depreciation asset register + schedule
// report (the CPA hand-off). Report-only books decision: depreciation is a
// non-cash expense — this panel never posts to the property ledger or the
// bank register. The report is computed server-side from the register by the
// pure domain engine; schedules always sum exactly to the depreciable basis.

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollarsToCents = (dollars) => {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};
const centsToDollars = (cents) => (cents === null || cents === undefined || cents === "" ? "" : String(Number(cents) / 100));
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
const categoryLabel = (code) => ASSET_CATEGORIES.find((c) => c.code === code)?.label || code;
const monthName = (month) => new Date(2000, month - 1, 1).toLocaleString("en-US", { month: "short" });

const NOT_TAX_ADVICE = "This is not tax advice — confirm depreciation treatment with your CPA.";

function emptyForm() {
  return {
    description: "", category: "other", placedInService: "", costDollars: "",
    method: "straight_line", usefulLifeMonths: "60", salvageDollars: "", notes: "",
  };
}

export default function DepreciationAssetsPanel({ propertyId, propertyLabel }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [mutateError, setMutateError] = useState("");
  const currentYear = new Date().getFullYear();
  const [reportYear, setReportYear] = useState(String(currentYear));

  // Stale-while-revalidate, same as the ledgers: revisiting a recently viewed
  // property serves the last register/report instantly and refreshes in the
  // background. Mutations call refresh() explicitly.
  const {
    data: assetsPayload, error: assetsError, isLoading: assetsLoading, refresh: refreshAssets,
  } = useStaleWhileRevalidate(
    propertyId ? `depreciation-assets:${propertyId}` : null,
    async () => {
      const response = await fetch(`/api/rental/depreciation-assets?propertyId=${encodeURIComponent(propertyId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load depreciation assets.");
      return body;
    },
    { ttlMs: 60_000 },
  );
  const assets = useMemo(() => assetsPayload?.assets || [], [assetsPayload]);

  const {
    data: reportPayload, error: reportError, isLoading: reportLoading, refresh: refreshReport,
  } = useStaleWhileRevalidate(
    propertyId && reportYear ? `depreciation-schedule:${propertyId}:${reportYear}` : null,
    async () => {
      const response = await fetch(
        `/api/rental/depreciation-assets/schedule?propertyId=${encodeURIComponent(propertyId)}&year=${encodeURIComponent(reportYear)}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to build the depreciation schedule.");
      return body;
    },
    { ttlMs: 60_000 },
  );
  const report = reportPayload?.report || null;

  const refreshAll = useCallback(() => { refreshAssets(); refreshReport(); }, [refreshAssets, refreshReport]);

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setSaveError("");
    setShowForm(true);
  }
  function startEdit(asset) {
    setEditingId(asset.id);
    setForm({
      description: asset.description, category: asset.category, placedInService: asset.placedInService,
      costDollars: centsToDollars(asset.costBasisCents), method: asset.method,
      usefulLifeMonths: String(asset.usefulLifeMonths), salvageDollars: centsToDollars(asset.salvageValueCents),
      notes: asset.notes || "",
    });
    setSaveError("");
    setShowForm(true);
  }

  async function saveAsset(event) {
    event.preventDefault();
    setSaveError("");
    const costBasisCents = dollarsToCents(form.costDollars);
    // MACRS tax depreciation does not recognize salvage value — the API
    // normalizes it to zero; send 0 so the stored row matches the schedule.
    // (Derived inline from form.method: saveAsset is declared before the
    // macrsLife memo, and capturing the memo there breaks the compiler's
    // manual-memoization preservation.)
    const isMacrsMethod = DEPRECIATION_METHODS[form.method]?.presetLifeMonths != null;
    const salvageDollars = isMacrsMethod ? 0 : (form.salvageDollars === "" ? 0 : dollarsToCents(form.salvageDollars));
    if (costBasisCents === null || costBasisCents <= 0) { setSaveError("Enter a cost basis above $0."); return; }
    if (salvageDollars === null) { setSaveError("Enter a valid salvage value."); return; }
    const payload = {
      description: form.description, category: form.category, placed_in_service: form.placedInService,
      cost_basis_cents: costBasisCents, method: form.method,
      useful_life_months: Number(form.usefulLifeMonths), salvage_value_cents: salvageDollars,
      notes: form.notes,
    };
    setSaving(true);
    try {
      const url = editingId
        ? `/api/rental/depreciation-assets/${encodeURIComponent(editingId)}`
        : "/api/rental/depreciation-assets";
      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? payload : { ...payload, propertyId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save the asset.");
      setShowForm(false);
      setEditingId(null);
      setMutateError("");
      refreshAll();
    } catch (caught) {
      setSaveError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAsset(asset) {
    if (!window.confirm(`Delete "${asset.description}"? The schedule rows for it disappear from every report.`)) return;
    try {
      const response = await fetch(`/api/rental/depreciation-assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete the asset.");
      refreshAll();
    } catch (caught) {
      setMutateError(caught.message);
    }
  }

  const macrsLife = useMemo(() => DEPRECIATION_METHODS[form.method]?.presetLifeMonths || null, [form.method]);

  const reportYearOptions = useMemo(() => {
    const years = new Set([currentYear]);
    for (const asset of assets) {
      const y = Number(String(asset.placedInService || "").slice(0, 4));
      if (Number.isInteger(y)) years.add(y);
    }
    return [...years].sort();
  }, [assets, currentYear]);

  return (
    <section aria-label="Assets and depreciation" className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Accountant-ready books</p>
          <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">Assets / Depreciation</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Track what each property owns — building, improvements, appliances, equipment — and get a per-year depreciation
            schedule {propertyLabel ? <>for <strong>{propertyLabel}</strong></> : null} to hand to the CPA.
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            Report-only: depreciation is a non-cash expense. This never posts to the property ledger or the bank register —
            the ledger stays cash-based. {NOT_TAX_ADVICE}
          </p>
        </div>
        <button type="button" onClick={startAdd} className="shrink-0 rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950">
          + Add asset
        </button>
      </div>

      {assetsError && <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-400">{assetsError.message}</p>}
      {mutateError && <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-400">{mutateError}</p>}

      {assetsLoading ? (
        <p className="mt-4 text-sm text-slate-500">Loading assets…</p>
      ) : assets.length === 0 && !showForm ? (
        <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          No depreciable assets yet. Add the building (minus land — land is not depreciable), then improvements,
          appliances, and equipment with their placed-in-service dates and cost.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="py-2 pr-3">Asset</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Placed in service</th>
                <th className="py-2 pr-3 text-right">Cost</th>
                <th className="py-2 pr-3">Method</th>
                <th className="py-2 pr-3 text-right">Life (mo)</th>
                <th className="py-2 pr-3 text-right">Salvage</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3 font-bold text-slate-900 dark:text-white">{asset.description}</td>
                  <td className="py-2 pr-3">{categoryLabel(asset.category)}</td>
                  <td className="py-2 pr-3">{formatDate(asset.placedInService)}</td>
                  <td className="py-2 pr-3 text-right">{money.format(asset.costBasisCents / 100)}</td>
                  <td className="py-2 pr-3">{asset.methodLabel}</td>
                  <td className="py-2 pr-3 text-right">{asset.usefulLifeMonths}</td>
                  <td className="py-2 pr-3 text-right">{money.format(asset.salvageValueCents / 100)}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => startEdit(asset)} className="mr-2 font-bold text-sky-700 underline dark:text-sky-400">Edit</button>
                    <button type="button" onClick={() => deleteAsset(asset)} className="font-bold text-red-700 underline dark:text-red-400">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <form onSubmit={saveAsset} className="mt-5 grid max-w-4xl gap-4 rounded-2xl border-2 border-sky-500 bg-sky-50 p-5 dark:border-sky-700 dark:bg-sky-950/30 md:grid-cols-2">
          <div className="md:col-span-2"><h4 className="text-lg font-black text-slate-950 dark:text-white">{editingId ? "Edit asset" : "New depreciation asset"}</h4></div>
          <label className="text-sm font-bold md:col-span-2">Description
            <input required type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Roof replacement, Refrigerator, HVAC unit…" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold">Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              {ASSET_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold">Placed in service
            <input required type="date" value={form.placedInService} onChange={(e) => setForm({ ...form, placedInService: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold">Cost basis ($)
            <input required type="number" min="0" step="0.01" value={form.costDollars} onChange={(e) => setForm({ ...form, costDollars: e.target.value })} placeholder="18000.00" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold">Salvage value ($)
            <input type="number" min="0" step="0.01" disabled={macrsLife !== null} value={macrsLife !== null ? "" : form.salvageDollars} onChange={(e) => setForm({ ...form, salvageDollars: e.target.value })} placeholder="0.00" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            {macrsLife !== null && <span className="mt-1 block text-xs font-normal text-slate-500">MACRS ignores salvage value — the full cost basis is recovered (IRS rules).</span>}
          </label>
          <label className="text-sm font-bold md:col-span-2">Depreciation method
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value, usefulLifeMonths: DEPRECIATION_METHODS[e.target.value]?.presetLifeMonths ? String(DEPRECIATION_METHODS[e.target.value].presetLifeMonths) : form.usefulLifeMonths })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              {Object.values(DEPRECIATION_METHODS).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-500">{DEPRECIATION_METHODS[form.method]?.description}</span>
          </label>
          <label className="text-sm font-bold">Useful life (months)
            <input required type="number" min="1" step="1" disabled={macrsLife !== null} value={macrsLife !== null ? String(macrsLife) : form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            {macrsLife !== null && <span className="mt-1 block text-xs font-normal text-slate-500">Locked to the MACRS preset ({macrsLife} months).</span>}
          </label>
          <label className="text-sm font-bold">Notes
            <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Serial number, invoice reference…" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          {saveError && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400 md:col-span-2">{saveError}</p>}
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" disabled={saving} className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-40">{saving ? "Saving…" : editingId ? "Save changes" : "Add asset"}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="rounded-xl border border-slate-300 px-5 py-3 font-bold dark:border-slate-600 dark:text-slate-300">Cancel</button>
          </div>
        </form>
      )}

      {/* Per-property schedule report — the CPA hand-off */}
      <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-lg font-black text-slate-950 dark:text-white">Depreciation schedule — {reportYear}</h4>
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold">Year
              <select value={reportYear} onChange={(e) => setReportYear(e.target.value)} className="ml-2 rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                {reportYearOptions.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black dark:border-slate-600 dark:text-slate-200">Print schedule</button>
          </div>
        </div>
        {reportError && <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-400">{reportError.message}</p>}
        {reportLoading ? (
          <p className="mt-3 text-sm text-slate-500">Building the schedule…</p>
        ) : report ? (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                    <th className="py-2 pr-3">Asset</th>
                    <th className="py-2 pr-3">Placed in service</th>
                    <th className="py-2 pr-3 text-right">Cost</th>
                    <th className="py-2 pr-3 text-right">Depreciation taken ({reportYear})</th>
                    <th className="py-2 pr-3 text-right">Accumulated</th>
                    <th className="py-2 pr-3 text-right">Book value</th>
                    <th className="py-2 text-right">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {report.assets.map((row) => (
                    <Fragment key={row.id}>
                      <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 pr-3 font-bold text-slate-900 dark:text-white">{row.description}</td>
                        <td className="py-2 pr-3">{formatDate(row.placedInService)}</td>
                        <td className="py-2 pr-3 text-right">{money.format(row.costBasisCents / 100)}</td>
                        <td className="py-2 pr-3 text-right">{money.format(row.depreciationTakenCents / 100)}</td>
                        <td className="py-2 pr-3 text-right">{money.format(row.accumulatedCents / 100)}</td>
                        <td className="py-2 pr-3 text-right font-bold">{money.format(row.remainingBookValueCents / 100)}</td>
                        <td className="py-2 text-right">
                          <button type="button" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} className="font-bold text-sky-700 underline dark:text-sky-400">
                            {expandedId === row.id ? "Hide" : "Schedule"}
                          </button>
                        </td>
                      </tr>
                      {expandedId === row.id && (
                        <tr key={`${row.id}-detail`} className="bg-slate-50 dark:bg-slate-800/60">
                          <td colSpan={7} className="px-4 py-3">
                            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Year-by-year schedule — {row.description}</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {row.scheduleByYear.map((yearRow) => (
                                <div key={yearRow.year} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                                  <p className="flex justify-between text-sm font-bold">
                                    <span>{yearRow.year}</span>
                                    <span>{money.format(yearRow.totalCents / 100)}</span>
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {yearRow.months.map((m) => `${monthName(m.month)} ${money.format(m.depreciationCents / 100)}`).join(" · ")}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-black text-slate-950 dark:text-white">
                    <td className="py-2 pr-3" colSpan={3}>Totals</td>
                    <td className="py-2 pr-3 text-right">{money.format(report.totals.depreciationTakenCents / 100)}</td>
                    <td className="py-2 pr-3 text-right">{money.format(report.totals.accumulatedCents / 100)}</td>
                    <td className="py-2 pr-3 text-right">{money.format(report.totals.remainingBookValueCents / 100)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">
              {NOT_TAX_ADVICE} Depreciation is a non-cash expense — these amounts are not posted to the ledger or the bank register.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
