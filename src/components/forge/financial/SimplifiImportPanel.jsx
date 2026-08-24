"use client";

import { useMemo, useState } from "react";

const money = (cents = 0) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(Number(cents) / 100);
const key = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const slug = (value) => key(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "uncategorized";

function suggestedTreatment(category) {
  const value = key(category);
  if (/transfer|credit card payment|card payment|loan payment|balance adjustment/.test(value)) return "transfer";
  if (/purchase price|asset purchase|real estate purchase/.test(value)) return "asset_purchase";
  return "operating";
}

// Counts every approvable row (both business "safe_missing" and personal), not just
// safe_missing — otherwise, once every business row is imported across earlier batches, the
// import button would disable itself while personal rows still remain unapproved.
export function approvableRowCount(rows) {
  return (rows ?? []).filter((row) => row?.approvable).length;
}

export default function SimplifiImportPanel() {
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState(null);
  const [accountMappings, setAccountMappings] = useState({});
  const [categoryMappings, setCategoryMappings] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const sourceAccounts = preview?.accounts ?? [];
  const sourceCategories = useMemo(() => {
    const labels = new Set((preview?.rows ?? []).map((row) => row.category).filter(Boolean));
    return [...labels].sort((a, b) => a.localeCompare(b));
  }, [preview]);

  function mappingPayloads() {
    return {
      accountMappings: Object.entries(accountMappings).map(([simplifi_account_name, mapping]) => ({
        simplifi_account_name, forge_account_id: mapping.forge_account_id,
        account_type: mapping.account_type || "other", scope: mapping.scope || "business",
      })).filter((mapping) => mapping.forge_account_id || mapping.scope === "excluded"),
      categoryMappings: Object.entries(categoryMappings).map(([simplifi_category, mapping]) => ({
        simplifi_category, normalized_category: mapping.normalized_category,
        treatment: mapping.treatment,
      })),
    };
  }

  async function call(endpoint, body) {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Simplifi import request failed.");
    return payload;
  }

  async function runPreview(nextCsv = csv, nextFile = file, mappings = mappingPayloads(), preserveResult = false) {
    setBusy(true); setError(""); if (!preserveResult) setResult(null);
    try {
      const payload = await call("/api/financial/simplifi-import-preview", {
        csv: nextCsv, fileName: nextFile?.name || "Simplifi-transactions.csv", ...mappings,
      });
      setPreview(payload);
      setCategoryMappings((current) => {
        const next = { ...current };
        for (const row of payload.rows ?? []) if (row.category && !next[row.category]) next[row.category] = {
          normalized_category: slug(row.category), treatment: suggestedTreatment(row.category),
        };
        return next;
      });
      setAccountMappings((current) => {
        const next = { ...current };
        const available = payload.available_accounts ?? [];
        for (const account of payload.accounts ?? []) {
          const exact = available.find((candidate) => key(candidate.name) === key(account.account_name));
          if (next[account.account_name]?.scope === "excluded" || next[account.account_name]?.forge_account_id) continue;
          next[account.account_name] = exact
            ? { ...next[account.account_name], forge_account_id: exact.id, account_type: exact.type, scope: next[account.account_name]?.scope || "business" }
            : { ...next[account.account_name], forge_account_id: "", account_type: "other", scope: next[account.account_name]?.scope || "business" };
        }
        return next;
      });
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  async function chooseFile(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const text = await selected.text();
    setFile(selected); setCsv(text); setPreview(null); setAccountMappings({}); setCategoryMappings({});
    await runPreview(text, selected, { accountMappings: [], categoryMappings: [] });
  }

  async function approveNextBatch() {
    const selected = (preview?.rows ?? []).filter((row) => row.approvable).slice(0, 500).map((row) => row.fingerprint);
    if (!selected.length || !window.confirm(`Import ${selected.length} reviewed Simplifi transactions now?`)) return;
    setBusy(true); setError("");
    try {
      const payload = await call("/api/financial/simplifi-import-approve", {
        csv, fileName: file?.name, batchHash: preview.batch_hash, previewHash: preview.preview_hash,
        selectedFingerprints: selected, ...mappingPayloads(),
      });
      setResult(payload.result);
      await runPreview(csv, file, mappingPayloads(), true);
    } catch (requestError) { setError(requestError.message); setBusy(false); }
  }

  async function createMissingAccounts() {
    const missing = sourceAccounts.filter((account) => {
      const mapping = accountMappings[account.account_name];
      return mapping?.scope !== "excluded" && !mapping?.forge_account_id;
    });
    if (!missing.length || !window.confirm(`Create and map ${missing.length} missing FORGE accounts? No transactions will be imported.`)) return;
    setBusy(true); setError("");
    try {
      const payload = await call("/api/financial/simplifi-import-accounts", { csv });
      setResult({ accounts_created: payload.created, accounts_reused: payload.reused });
      await runPreview(csv, file, mappingPayloads(), true);
    } catch (requestError) { setError(requestError.message); setBusy(false); }
  }

  const safeCount = approvableRowCount(preview?.rows);
  const mappingsComplete = sourceAccounts.length > 0 && sourceAccounts.every((account) => {
    const mapping = accountMappings[account.account_name];
    return mapping?.scope === "excluded" || Boolean(mapping?.forge_account_id);
  });

  return <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-simplifi-import-panel>
    <div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-600">Financial data</p><h2 className="mt-2 text-2xl font-black">Import Quicken Simplifi history</h2>
      <p className="mt-2 max-w-4xl text-sm text-slate-600 dark:text-slate-300">Your CSV is processed for this request and is never stored. Preview, map, and review first; approval imports at most 500 transactions at a time.</p></div>
    <label className="block rounded-2xl border-2 border-dashed border-cyan-300 p-5 font-bold focus-within:ring-2 focus-within:ring-cyan-500">
      Select Simplifi transactions CSV
      <input type="file" accept=".csv,text/csv" onChange={chooseFile} className="mt-3 block w-full text-sm" />
    </label>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 font-bold text-red-800">{error}</p> : null}
    {busy ? <p role="status" className="rounded-xl bg-cyan-50 p-4 font-bold text-cyan-900">Working…</p> : null}
    {preview ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Object.entries(preview.totals ?? {}).map(([label, total]) => <div key={label} className="rounded-2xl bg-slate-100 p-4 dark:bg-slate-800"><p className="text-xs font-black uppercase text-slate-500">{label.replaceAll("_", " ")}</p><p className="mt-1 text-xl font-black">{total.count}</p><p className="text-sm">{money(total.amount_cents)}</p></div>)}</div>
      <details open className="rounded-2xl border p-4"><summary className="cursor-pointer font-black">1. Map {sourceAccounts.length} Simplifi accounts</summary>
        {!mappingsComplete ? <button type="button" disabled={busy} onClick={createMissingAccounts} className="mt-4 rounded-xl bg-cyan-600 px-4 py-2 font-black text-white disabled:opacity-40">Create and map missing FORGE accounts</button> : null}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{sourceAccounts.map((account) => <div key={account.account_name} className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800 sm:grid-cols-[1fr_1fr_auto]">
          <div><p className="font-bold">{account.account_name}</p><p className="text-xs text-slate-500">{account.row_count} rows · {money(account.amount_cents)}</p></div>
          <select aria-label={`FORGE account for ${account.account_name}`} disabled={accountMappings[account.account_name]?.scope === "excluded"} value={accountMappings[account.account_name]?.forge_account_id || ""} onChange={(event) => setAccountMappings((current) => ({ ...current, [account.account_name]: { ...current[account.account_name], forge_account_id: event.target.value, account_type: preview.available_accounts.find((item) => item.id === event.target.value)?.type || "other" } }))} className="rounded-lg border bg-white px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950">
            <option value="">Choose FORGE account</option>{preview.available_accounts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
          <select aria-label={`Scope for ${account.account_name}`} value={accountMappings[account.account_name]?.scope || "business"} onChange={(event) => setAccountMappings((current) => ({ ...current, [account.account_name]: { ...current[account.account_name], scope: event.target.value } }))} className="rounded-lg border bg-white px-2 py-2 text-sm dark:bg-slate-950"><option value="business">Business</option><option value="personal">Personal</option><option value="mixed">Mixed</option><option value="excluded">Exclude</option></select>
        </div>)}</div>
      </details>
      <details className="rounded-2xl border p-4"><summary className="cursor-pointer font-black">2. Review {sourceCategories.length} category treatments</summary>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{sourceCategories.map((category) => <div key={category} className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800 sm:grid-cols-[1fr_1fr_1fr]">
          <span className="font-bold">{category}</span><input aria-label={`FORGE category for ${category}`} value={categoryMappings[category]?.normalized_category || ""} onChange={(event) => setCategoryMappings((current) => ({ ...current, [category]: { ...current[category], normalized_category: slug(event.target.value) } }))} className="rounded-lg border bg-white px-2 py-2 text-sm dark:bg-slate-950" />
          <select aria-label={`Treatment for ${category}`} value={categoryMappings[category]?.treatment || "operating"} onChange={(event) => setCategoryMappings((current) => ({ ...current, [category]: { ...current[category], treatment: event.target.value } }))} className="rounded-lg border bg-white px-2 py-2 text-sm dark:bg-slate-950"><option value="operating">Operating income/expense</option><option value="transfer">Transfer/payment</option><option value="asset_purchase">Asset purchase</option><option value="exclude">Exclude</option></select>
        </div>)}</div>
      </details>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || !mappingsComplete} onClick={() => runPreview()} className="rounded-xl bg-slate-900 px-5 py-3 font-black text-white disabled:opacity-40 dark:bg-cyan-500 dark:text-slate-950">Refresh reviewed preview</button>
        <button type="button" disabled={busy || safeCount === 0 || !mappingsComplete} onClick={approveNextBatch} className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-40">Import next {Math.min(500, safeCount)} reviewed rows</button></div>
      {result ? <p role="status" className="rounded-xl bg-emerald-50 p-4 font-bold text-emerald-900">{result.accounts_created !== undefined ? `Created ${result.accounts_created}; reused ${result.accounts_reused ?? 0} FORGE accounts. No transactions imported.` : `Applied ${result.applied ?? 0}; already imported ${result.already_applied ?? 0}.`}</p> : null}
    </> : null}
  </section>;
}
