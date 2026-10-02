"use client";
import { useCallback, useEffect, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";

// Rentec parity R20 — the Mailing Manager surface (Rentec's Mailing Manager:
// certified letters with templates, tracking numbers, delivery confirmation,
// bulk send, copies in the file library).
//
// Four tabs: Compose (pick a template + tenants, preview with real data,
// print, queue), Queue & tracking (batches with queued/mailed/delivered
// counts; per-letter tracking-number entry and status moves), Templates
// (the mailing-kind library — edits live in the Message templates library
// under Communications), Provider (the paid-send layer, hard-gated: it
// always shows "not connected" and the three approvals Jason must give).
//
// Letters are NEVER sent through a provider by this surface: queueing means
// "print and mail at the post office, then type in the tracking number".

const TABS = [
  { id: "compose", label: "Compose" },
  { id: "queue", label: "Queue & tracking" },
  { id: "templates", label: "Templates" },
  { id: "provider", label: "Provider" },
];
const STATUS_LABEL = { queued: "Queued", mailed: "Mailed", delivered: "Delivered" };

export default function RentalMailingPanel() {
  const [tab, setTab] = useState("compose");
  const [batchDetail, setBatchDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Data loads: stale-while-revalidate under four keys (the
  // RentalCommunicationsPanel pattern). Mutations refresh the affected key;
  // switching away and back renders the last good list instantly.
  const fetchTemplates = useCallback(async () => {
    const response = await fetch("/api/rental/message-templates?kind=mailing&audience=tenant");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load letter templates.");
    return body.templates || [];
  }, []);
  const fetchMaster = useCallback(async () => {
    const response = await fetch("/api/rental");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load tenants.");
    return (body.tenants || []).filter((tenant) => ["active", "invited"].includes(tenant.status));
  }, []);
  const fetchBatches = useCallback(async () => {
    const response = await fetch("/api/rental/mailing");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load mailing batches.");
    return body.batches || [];
  }, []);
  const fetchProvider = useCallback(async () => {
    const response = await fetch("/api/rental/mailing/provider");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load provider status.");
    return body.provider || null;
  }, []);
  const { data: templatesData, error: templatesError, isLoading: templatesLoading, refresh: refreshTemplates } =
    useStaleWhileRevalidate("rental:mailing-templates", fetchTemplates, { ttlMs: 60_000 });
  const { data: tenantsData, error: tenantsError, isLoading: tenantsLoading, refresh: refreshMaster } =
    useStaleWhileRevalidate("rental:mailing-master", fetchMaster, { ttlMs: 60_000 });
  const { data: batchesData, error: batchesError, isLoading: batchesLoading, refresh: refreshBatches } =
    useStaleWhileRevalidate("rental:mailing-batches", fetchBatches, { ttlMs: 60_000 });
  const { data: providerData, error: providerError, isLoading: providerLoading } =
    useStaleWhileRevalidate("rental:mailing-provider", fetchProvider, { ttlMs: 60_000 });

  const templates = templatesData || [];
  const tenants = tenantsData || [];
  const batches = batchesData || [];
  const provider = providerData || null;
  const loading = templatesLoading || tenantsLoading || batchesLoading || providerLoading;
  const loadError = templatesError || tenantsError || batchesError || providerError;
  const displayError = error || (loadError ? loadError.message : "");

  // Composer state
  const [templateId, setTemplateId] = useState("");
  const [batchName, setBatchName] = useState("");
  const [returnAddress, setReturnAddress] = useState("");
  const [selected, setSelected] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [preview, setPreview] = useState(null);
  const [printLetters, setPrintLetters] = useState(null);

  // Tracking editor state (per letter)
  const [trackingInputs, setTrackingInputs] = useState({});

  // Print sheet: render the letters print-only, then print.
  useEffect(() => {
    if (printLetters) window.print();
  }, [printLetters]);

  function toggleTenant(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function loadPreview() {
    if (!templateId || selected.length === 0) { setError("Pick a template and at least one tenant first."); return; }
    setBusy(true); setError(""); setMessage(""); setPreview(null);
    try {
      const response = await fetch("/api/rental/mailing/render", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId, tenantId: selected[0],
          returnAddress, recipientAddress: overrides[selected[0]] || "",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to render the letter.");
      const tenant = tenants.find((item) => item.id === selected[0]);
      setPreview({ ...body, tenantName: tenant?.display_name || "" });
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function queueBatch() {
    if (!templateId || selected.length === 0) { setError("Pick a template and at least one tenant first."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/mailing", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: batchName, templateId, tenantIds: selected, returnAddress, recipientAddresses: overrides,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to queue the mailing batch.");
      setMessage(`Queued ${body.batch.letters.length} letter${body.batch.letters.length === 1 ? "" : "s"} in "${body.batch.name}". ${body.note || ""}`);
      setSelected([]); setOverrides({}); setPreview(null); setBatchName("");
      await refreshBatches();
      setTab("queue");
      await openBatch(body.batch.id);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function openBatch(id) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rental/mailing/batches/${encodeURIComponent(id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load the batch.");
      setBatchDetail(body.batch);
      setTrackingInputs(Object.fromEntries((body.batch.letters || []).map((letter) => [letter.id, letter.trackingNumber || ""])));
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function updateLetter(letterId, patch) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/rental/mailing/letters/${encodeURIComponent(letterId)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update the letter.");
      setMessage(patch.status ? `Letter marked ${STATUS_LABEL[patch.status].toLowerCase()}.` : "Tracking number saved.");
      await openBatch(batchDetail.id);
      await refreshBatches();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function tryProviderSend() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/mailing/provider", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The provider send was refused.");
      setMessage("Provider send completed.");
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const summary = batchDetail?.summary || { total: 0, queued: 0, mailed: 0, delivered: 0 };

  return <section aria-label="Mailing Manager" className="mt-6 print:mt-0">
    <style>{`@media print { @page { margin: 0.75in; } .mailing-print-sheet { display: block !important; } .mailing-print-sheet .letter-page { break-after: page; } .mailing-print-sheet .letter-page:last-child { break-after: auto; } }`}</style>

    {/* Print-only sheet: the queued letters, one per page. Screen hides it; print shows only it. */}
    {printLetters ? <div aria-hidden className="mailing-print-sheet hidden">
      {printLetters.map((letter) => <div key={letter.id} className="letter-page">
        {letter.returnAddress ? <p className="whitespace-pre-line text-sm">{letter.returnAddress}</p> : null}
        {letter.letterDate ? <p className="mt-4 text-sm">{new Date(`${letter.letterDate}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p> : null}
        <p className="mt-4 whitespace-pre-line text-sm font-bold">{letter.tenantName}{"\n"}{letter.recipientAddress}</p>
        {letter.subject ? <p className="mt-4 text-sm font-bold">Re: {letter.subject}</p> : null}
        <p className="mt-4 text-sm font-bold uppercase tracking-widest">Via certified mail</p>
        <div className="mt-4 whitespace-pre-line text-sm leading-relaxed">{letter.body}</div>
      </div>)}
    </div> : null}

    <div className="print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-950 dark:text-white">Mailing Manager</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Certified letters, Rentec-style: pick a template, preview each letter with real tenant data,
            print, then mail at the post office and record the tracking numbers here. Letters are never
            sent through a mail provider by this software — that stays off until Jason approves it.
          </p>
        </div>
      </div>

      {displayError ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{displayError}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</p> : null}

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Mailing sections">
        {TABS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id}
          onClick={() => setTab(entry.id)}
          className={`rounded-full px-4 py-2 text-sm font-bold transition ${tab === entry.id ? "bg-slate-950 text-white dark:bg-amber-400 dark:text-slate-950" : "border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
          {entry.label}
        </button>)}
      </div>

      {loading ? <p className="mt-4 text-sm text-slate-500">Loading mailing data…</p> : null}

      {!loading && tab === "compose" ? <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form aria-label="Compose letters" onSubmit={(event) => { event.preventDefault(); queueBatch(); }}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <label className="block text-sm font-bold text-slate-900 dark:text-white">Letter template
            <select required value={templateId} onChange={(event) => setTemplateId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white">
              <option value="">Pick a template…</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.isSystem ? " (system)" : ""}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-900 dark:text-white">Batch name
            <input value={batchName} maxLength={120} onChange={(event) => setBatchName(event.target.value)}
              placeholder="e.g. October late notices"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white" />
          </label>
          <label className="block text-sm font-bold text-slate-900 dark:text-white">Return address <span className="font-normal text-slate-500">(printed on every letter)</span>
            <textarea value={returnAddress} rows={3} maxLength={500}
              onChange={(event) => setReturnAddress(event.target.value)}
              placeholder={"Your name\n123 Main St\nAustin, TX 78701"}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white" />
          </label>
          <fieldset>
            <legend className="text-sm font-bold text-slate-900 dark:text-white">Tenants <span className="font-normal text-slate-500">({selected.length} selected)</span></legend>
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
              {tenants.length === 0 ? <p className="text-sm text-slate-500">No active tenants found.</p> : null}
              {tenants.map((tenant) => <div key={tenant.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <input type="checkbox" checked={selected.includes(tenant.id)} onChange={() => toggleTenant(tenant.id)} className="h-4 w-4" />
                  {tenant.display_name}
                </label>
                {selected.includes(tenant.id) ? <label className="mt-2 block text-xs font-bold text-slate-600 dark:text-slate-400">Recipient address <span className="font-normal">(leave blank to use the unit address)</span>
                  <textarea value={overrides[tenant.id] || ""} rows={2} maxLength={500}
                    onChange={(event) => setOverrides((current) => ({ ...current, [tenant.id]: event.target.value }))}
                    placeholder="Only if different from the unit address"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white" />
                </label> : null}
              </div>)}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !templateId || selected.length === 0} onClick={loadPreview}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              {busy ? "Working…" : "Preview letter"}
            </button>
            <button disabled={busy || !templateId || selected.length === 0}
              className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">
              {busy ? "Queueing…" : `Queue ${selected.length} letter${selected.length === 1 ? "" : "s"}`}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Queueing saves one letter per tenant and a copy in the file library. Nothing is sent electronically — print the batch and mail it at the post office.
          </p>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-base font-black text-slate-950 dark:text-white">Letter preview</h4>
            {preview ? <button type="button" onClick={() => window.print()}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white print:hidden hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">
              Print or save as PDF
            </button> : null}
          </div>
          {!preview ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Pick a template and tenants, then preview the letter with real data before queueing.</p> : null}
          {preview ? <article className="mt-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none dark:border-slate-700 dark:bg-slate-900">
            {returnAddress ? <p className="whitespace-pre-line text-sm text-slate-800 dark:text-slate-200">{returnAddress}</p> : null}
            <p className="mt-4 text-sm text-slate-800 dark:text-slate-200">{preview.tenantName}</p>
            <p className="mt-4 text-sm font-bold uppercase tracking-widest text-slate-500">Via certified mail</p>
            {preview.subject ? <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">Re: {preview.subject}</p> : null}
            <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-200">{preview.body}</div>
            {preview.missingFields?.length ? <p className="mt-3 text-xs font-bold text-amber-700 dark:text-amber-300">
              Missing data (left blank): {preview.missingFields.join(", ")} — fix the tenant record or the template before queueing.
            </p> : null}
            {preview.unknownFields?.length ? <p className="mt-3 text-xs font-bold text-red-700 dark:text-red-300">
              Unknown {"{{field}}"} tokens (kept as-is — check for typos): {preview.unknownFields.join(", ")}.
            </p> : null}
          </article> : null}
        </div>
      </div> : null}

      {!loading && tab === "queue" ? <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <h4 className="text-base font-black text-slate-950 dark:text-white">Batches</h4>
          {batches.length === 0 ? <p className="mt-2 text-sm text-slate-500">No batches yet — compose your first batch above.</p> : null}
          <ul className="mt-2 space-y-2">
            {batches.map((batch) => <li key={batch.id}>
              <button type="button" onClick={() => openBatch(batch.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${batchDetail?.id === batch.id ? "border-slate-950 bg-slate-50 dark:border-amber-400 dark:bg-slate-950/40" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
                <p className="text-sm font-bold text-slate-950 dark:text-white">{batch.name}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {batch.summary.total} letters · {batch.summary.queued} queued · {batch.summary.mailed} mailed · {batch.summary.delivered} delivered
                </p>
              </button>
            </li>)}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40 lg:col-span-2">
          {!batchDetail ? <p className="text-sm text-slate-500 dark:text-slate-400">Pick a batch to see its letters, record tracking numbers, and mark delivery.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-black text-slate-950 dark:text-white">{batchDetail.name}</h4>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {summary.total} letters · <span className="font-bold">{summary.queued} queued</span> · <span className="font-bold">{summary.mailed} mailed</span> · <span className="font-bold">{summary.delivered} delivered</span>
                </p>
              </div>
              <button type="button" disabled={busy}
                onClick={() => setPrintLetters(batchDetail.letters)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                Print batch
              </button>
            </div>
            <ul className="mt-4 space-y-3">
              {batchDetail.letters.map((letter) => <li key={letter.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-950 dark:text-white">{letter.tenantName}</p>
                    <p className="mt-0.5 whitespace-pre-line text-xs text-slate-500 dark:text-slate-400">{letter.recipientAddress}</p>
                    {letter.subject ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Re: {letter.subject}</p> : null}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${letter.status === "delivered" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : letter.status === "mailed" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {STATUS_LABEL[letter.status]}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Tracking number
                    <input value={trackingInputs[letter.id] ?? ""} maxLength={30}
                      onChange={(event) => setTrackingInputs((current) => ({ ...current, [letter.id]: event.target.value }))}
                      placeholder="From the post-office receipt"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <div className="flex items-end gap-2">
                    <button type="button" disabled={busy} onClick={() => updateLetter(letter.id, { trackingNumber: trackingInputs[letter.id] || "" })}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Save</button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {letter.status === "queued" ? <button type="button" disabled={busy} onClick={() => updateLetter(letter.id, { status: "mailed", trackingNumber: trackingInputs[letter.id] || "" })}
                    className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">Mark mailed</button> : null}
                  {letter.status === "mailed" ? <>
                    <button type="button" disabled={busy} onClick={() => updateLetter(letter.id, { status: "delivered" })}
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">Mark delivered</button>
                    <button type="button" disabled={busy} onClick={() => updateLetter(letter.id, { status: "queued" })}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Back to queued</button>
                  </> : null}
                  {letter.status === "delivered" ? <button type="button" disabled={busy} onClick={() => updateLetter(letter.id, { status: "mailed" })}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Reopen as mailed</button> : null}
                  <button type="button" onClick={() => setPrintLetters([letter])}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Print</button>
                </div>
                {letter.documentId ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">A copy is saved in the file library (Documents).</p> : null}
              </li>)}
            </ul>
          </> }
        </div>
      </div> : null}

      {!loading && tab === "templates" ? <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h4 className="text-base font-black text-slate-950 dark:text-white">Letter templates</h4>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          The mailing-kind templates from the message templates library. To create or edit one, open
          the <span className="font-bold">Message templates</span> library under Communications — system
          templates are read-only there; duplicate one to customize it.
        </p>
        {templates.length === 0 ? <p className="mt-3 text-sm text-slate-500">No mailing templates yet.</p> : null}
        <ul className="mt-3 space-y-2">
          {templates.map((template) => <li key={template.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="font-bold text-slate-950 dark:text-white">{template.name}
              {template.isSystem ? <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">System</span> : null}
            </p>
            {template.subject ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Subject: {template.subject}</p> : null}
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{template.body}</p>
          </li>)}
        </ul>
      </div> : null}

      {!loading && tab === "provider" ? <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/20">
        <h4 className="text-base font-black text-slate-950 dark:text-white">Send via provider</h4>
        <p className="mt-2 text-sm font-bold text-amber-800 dark:text-amber-300">
          {provider?.message || "Send via provider: not connected — print or mail manually."}
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          No mail provider (USPS, Lob, or any other) is connected, and none is signed up for. Letters
          queued here are printed and mailed by hand — that is the entire free layer, and it costs
          nothing beyond postage at the counter. Before any provider can send a letter, Jason must
          approve all three of these:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {(provider?.pendingApprovals || []).map((item) => <li key={item}>{item}</li>)}
        </ol>
        <button type="button" disabled={busy} onClick={tryProviderSend}
          className="mt-4 rounded-xl border border-amber-400 px-5 py-2.5 text-sm font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/40">
          {busy ? "Working…" : "Try provider send (will be refused)"}
        </button>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          The button above proves the gate: the server refuses with a 409 and no outbound request is
          ever made. Nothing here can spend money.
        </p>
      </div> : null}
    </div>
  </section>;
}
